import { MODULE_ID } from "../constants.mjs"
import { extractDamageFromMessage } from "./damage-message.mjs"
import { installGlobalApplyListener } from "./render-global-listener.mjs"

function createIcon(className) {
   const icon = document.createElement("i")
   icon.className = className
   return icon
}

export function setupRenderChatMessageHook() {
   installGlobalApplyListener()

   Hooks.on("renderChatMessageHTML", (message, htmlElement) => {
      const domElement = htmlElement
      const calledShotsEnabled = game.settings.get(
         MODULE_ID,
         "enableCalledShots",
      )

      if (!calledShotsEnabled) return
      if (game.user.role < CONST.USER_ROLES.ASSISTANT) return

      const partName = message.getFlag(MODULE_ID, "calledShotPartName")
      const partId = message.getFlag(MODULE_ID, "calledShotPartId")

      if (partName && partId) {
         const damageButtons = domElement.querySelectorAll(
            'button[data-action="strike-damage"], button[data-action="strike-critical"], button[data-action="damage"], button[data-action="spell-damage"], button[data-action="elemental-blast-damage"]',
         )
         damageButtons.forEach((btn) => {
            btn.addEventListener(
               "click",
               () => {
                  const targetTokenUuid =
                     message.flags.pf2e?.context?.target?.token ||
                     message.flags?.["pf2e-toolbelt"]?.targetHelper
                        ?.targets?.[0] ||
                     Array.from(game.user.targets)[0]?.document?.uuid
                  const pendingData = {
                     partId,
                     partName,
                     targetToken: targetTokenUuid,
                  }
                  window.rntPendingCalledShot = pendingData
                  game.user.setFlag(
                     MODULE_ID,
                     "pendingDamageCalledShot",
                     pendingData,
                  )
               },
               { capture: true },
            )
         })
      }

      const isMerged = message.flags?.["pf2e-toolbelt"]?.mergeDamage?.merged
      const isDmg =
         message.isDamageRoll ||
         message.flags?.pf2e?.context?.type === "damage-roll" ||
         isMerged
      if (!isDmg) return

      setTimeout(async () => {
         const msgDom =
            document.querySelector(`li[data-message-id="${message.id}"]`) ||
            domElement
         const diceTotal = msgDom.querySelector(".dice-total")
         if (!diceTotal) return

         if (msgDom.querySelector(".rnt-reaction-card")) return
         if (diceTotal.querySelector(".rnt-apply-damage-btn")) return

         const targetRowsContainer = msgDom.querySelector(
            ".pf2e-toolbelt-target-targetRows",
         )
         let saveRows = []
         if (targetRowsContainer) {
            const rows = targetRowsContainer.querySelectorAll(".target-row")
            rows.forEach((row) => {
               if (
                  row.querySelector(
                     "a[data-action='roll-save'], a[data-action='reroll-save']",
                  )
               ) {
                  saveRows.push(row)
               }
            })
         }

         if (saveRows.length > 1) {
            saveRows.forEach((row) => {
               const controls = row.querySelector(".target-header .controls")
               if (!controls) return

               if (controls.querySelector(".rnt-apply-damage-btn-target"))
                  return

               const targetAppSection = row.querySelector(".damage-application")
               const targetUuid = targetAppSection?.dataset.targetUuid
               if (!targetUuid) return

               const applyBtn = document.createElement("a")
               applyBtn.className = "rnt-apply-damage-btn-target"
               applyBtn.title = game.i18n.localize(
                  `${MODULE_ID}.applyToBodyPart`,
               )
               applyBtn.appendChild(createIcon("fa-solid fa-crosshairs"))
               applyBtn.style.cursor = "pointer"
               applyBtn.style.marginLeft = "4px"

               controls.appendChild(applyBtn)

               applyBtn.addEventListener(
                  "click",
                  async (e) => {
                     e.preventDefault()
                     e.stopPropagation()

                     const tDoc = await fromUuid(targetUuid)
                     if (!tDoc || !tDoc.actor) return
                     const tParts = tDoc.actor.getFlag(MODULE_ID, "parts") || []
                     if (tParts.length === 0) return

                     const currentMessage =
                        game.messages.get(message.id) || message
                     const { damages, rollOptions } =
                        extractDamageFromMessage(currentMessage)

                     const domMats = msgDom.querySelectorAll("[data-material]")
                     domMats.forEach((el) =>
                        rollOptions.push(
                           `item:material:${el.dataset.material}`,
                        ),
                     )
                     const domTraits = msgDom.querySelectorAll("[data-trait]")
                     domTraits.forEach((el) =>
                        rollOptions.push(`item:trait:${el.dataset.trait}`),
                     )

                     if (!damages.length) {
                        ui.notifications.warn(
                           game.i18n.localize(
                              `${MODULE_ID}.noValidDamageInRoll`,
                           ),
                        )
                        return
                     }

                     let multiplier = 1
                     const degreeSpan = controls.querySelector(".degree")
                     if (degreeSpan) {
                        const cls = degreeSpan.className.toLowerCase()
                        if (
                           cls.includes("critical-success") ||
                           cls.includes("criticalsuccess")
                        ) {
                           multiplier = 0
                        } else if (cls.includes("success")) {
                           multiplier = 0.5
                        } else if (
                           cls.includes("critical-failure") ||
                           cls.includes("criticalfailure")
                        ) {
                           multiplier = 2
                        }
                     }

                     if (multiplier === 0) {
                        ui.notifications.info(
                           game.i18n.localize(
                              `${MODULE_ID}.targetCriticalSuccessNoDamage`,
                           ),
                        )
                        return
                     }

                     let pId = null
                     const saveBtn = controls.querySelector(
                        "a[data-action='reroll-save'], a[data-action='roll-save']",
                     )

                     if (saveBtn && saveBtn.dataset.tooltip) {
                        const tooltip = saveBtn.dataset.tooltip
                        for (const p of tParts) {
                           const escapedName = p.name.replace(
                              /[.*+?^${}()|[\]\\]/g,
                              "\\$&",
                           )
                           const regex = new RegExp(
                              `${escapedName}\\s*Save`,
                              "i",
                           )
                           if (regex.test(tooltip)) {
                              pId = p.id
                              break
                           }
                        }
                     }

                     if (!pId) {
                        const activeParts = tParts.filter(
                           (p) =>
                              p.hp?.value > 0 &&
                              (!p.isHidden ||
                                 game.user.role >= CONST.USER_ROLES.ASSISTANT),
                        )
                        if (activeParts.length === 1) {
                           pId = activeParts[0].id
                        }
                     }

                     const openDamageApp = async (selectedPartId) => {
                        const finalDamages = damages
                           .map((d) => {
                              let amt = d.amount
                              if (typeof amt === "number") {
                                 amt = Math.floor(amt * multiplier)
                              }
                              return {
                                 amount: amt,
                                 dmgType: d.dmgType,
                                 dmgCategory: d.category,
                              }
                           })
                           .filter(
                              (d) =>
                                 typeof d.amount === "string" || d.amount > 0,
                           )

                        if (finalDamages.length === 0) {
                           ui.notifications.info(
                              game.i18n.localize(
                                 `${MODULE_ID}.damageReducedToZero`,
                              ),
                           )
                           return
                        }

                        const bm = await import("../apps/body-part-app.mjs")
                        new bm.DamageBodyPartApp({
                           actor: tDoc.actor,
                           partId: selectedPartId,
                           initialDamages: finalDamages,
                           rollOptions: rollOptions,
                        }).render(true)
                     }

                     if (pId) {
                        openDamageApp(pId)
                     } else {
                        const m = await import("../apps/called-shot-app.mjs")
                        new m.CalledShotTargetApp({
                           actor: tDoc.actor,
                           parts: tParts,
                           resolve: (result) => {
                              if (result && result.type === "part") {
                                 openDamageApp(result.part.id)
                              }
                           },
                        }).render(true)
                     }
                  },
                  { capture: true },
               )
            })
            return
         }

         const targetUuid =
            message.flags?.pf2e?.context?.target?.token ||
            message.getFlag(MODULE_ID, "targetUuid") ||
            message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets?.[0] ||
            Array.from(game.user.targets)[0]?.document?.uuid

         if (!targetUuid) return
         const targetDoc = await fromUuid(targetUuid)
         if (!targetDoc || !targetDoc.actor) return

         const parts = targetDoc.actor.getFlag(MODULE_ID, "parts") || []
         if (parts.length === 0) return

         const cpId = message.getFlag(MODULE_ID, "calledShotPartId")
         const cpName = message.getFlag(MODULE_ID, "calledShotPartName")

         const toolbeltContainer = diceTotal.querySelector(
            ".pf2e-toolbelt-target-buttons",
         )
         const setTargetsBtn = toolbeltContainer?.querySelector(
            '[data-action="set-targets"]',
         )

         const applyBtn = document.createElement("button")
         applyBtn.type = "button"
         applyBtn.className =
            "pf2e-toolbelt-target-setTargets targets rnt-apply-damage-btn"
         applyBtn.title = cpName
            ? game.i18n.format(`${MODULE_ID}.applyToPart`, { partName: cpName })
            : game.i18n.localize(`${MODULE_ID}.applyToBodyPart`)
         applyBtn.appendChild(createIcon("fa-solid fa-crosshairs"))

         if (toolbeltContainer) {
            if (setTargetsBtn) {
               setTargetsBtn.insertAdjacentElement("afterend", applyBtn)
            } else {
               toolbeltContainer.insertBefore(
                  applyBtn,
                  toolbeltContainer.firstChild,
               )
            }
         } else {
            const fallbackContainer = document.createElement("div")
            fallbackContainer.className =
               "pf2e-toolbelt-target-buttons rnt-called-shot-actions"
            fallbackContainer.style.cssText = "display: flex; margin-left: 1px;"
            fallbackContainer.appendChild(applyBtn)

            diceTotal.style.display = "flex"
            diceTotal.style.alignItems = "center"
            diceTotal.appendChild(fallbackContainer)
         }

         applyBtn.addEventListener(
            "click",
            async (e) => {
               e.preventDefault()
               e.stopPropagation()

               const currentMessage = game.messages.get(message.id) || message
               const { damages, rollOptions } =
                  extractDamageFromMessage(currentMessage)

               const domMats = msgDom.querySelectorAll("[data-material]")
               domMats.forEach((el) =>
                  rollOptions.push(`item:material:${el.dataset.material}`),
               )
               const domTraits = msgDom.querySelectorAll("[data-trait]")
               domTraits.forEach((el) =>
                  rollOptions.push(`item:trait:${el.dataset.trait}`),
               )

               if (!damages.length) {
                  ui.notifications.warn(
                     game.i18n.localize(`${MODULE_ID}.noValidDamageInRoll`),
                  )
                  return
               }

               const openDamageApp = async (partId) => {
                  const bm = await import("../apps/body-part-app.mjs")
                  new bm.DamageBodyPartApp({
                     actor: targetDoc.actor,
                     partId: partId,
                     initialDamages: damages.map((fd) => ({
                        amount: fd.amount,
                        dmgType: fd.dmgType,
                        dmgCategory: fd.category,
                     })),
                     rollOptions: rollOptions,
                  }).render(true)
               }

               if (!cpId) {
                  const m = await import("../apps/called-shot-app.mjs")
                  new m.CalledShotTargetApp({
                     actor: targetDoc.actor,
                     parts: parts,
                     resolve: (result) => {
                        if (result && result.type === "part") {
                           openDamageApp(result.part.id)
                        }
                     },
                  }).render(true)
               } else {
                  openDamageApp(cpId)
               }
            },
            { capture: true },
         )
      }, 0)
   })
}
