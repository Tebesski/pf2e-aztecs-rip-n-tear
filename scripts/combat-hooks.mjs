import { MODULE_ID } from "./constants.mjs"
import { DamageBodyPartApp } from "./apps/body-part-app.mjs"
import { CalledShotTargetApp } from "./apps/called-shot-app.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates`

function getTargetDoc(tokenRef) {
   if (!tokenRef) return null
   if (typeof tokenRef === "string") return fromUuidSync(tokenRef)
   return tokenRef.document || tokenRef
}

function categorizeDamageInstance(inst, isSplashRoll) {
   let dmgType = inst.type || "untyped"
   const instOpts = inst.options ? Array.from(inst.options) : []
   let dmgCategory = inst.category || ""

   if (
      inst.category === "splash" ||
      instOpts.includes("splash") ||
      instOpts.includes("trait:splash") ||
      isSplashRoll
   ) {
      dmgCategory = "splash"
   } else if (
      inst.persistent ||
      inst.category === "persistent" ||
      instOpts.includes("persistent") ||
      instOpts.includes("trait:persistent") ||
      dmgType === "bleed" ||
      (typeof dmgType === "string" && dmgType.includes("persistent"))
   ) {
      dmgCategory = "persistent"
   } else if (
      inst.category === "precision" ||
      instOpts.includes("precision") ||
      instOpts.includes("trait:precision")
   ) {
      dmgCategory = "precision"
   }

   if (typeof dmgType === "string" && dmgType.includes("persistent")) {
      dmgType =
         dmgType.replace("persistent", "").replace(",", "").trim() || "untyped"
   }

   return { dmgType, dmgCategory }
}

function resolvePersistentAmount(inst) {
   const formula =
      inst.expression ||
      inst.head?.expression ||
      inst.formula ||
      inst._formula ||
      ""
   if (!formula || typeof formula !== "string") return formula
   if (!formula.includes("d")) {
      return parseInt(formula, 10) || formula
   }
   return formula
}

function capitalize(s) {
   return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function setupSavingThrowHook(originalCheckRoll) {
   game.pf2e.Check.roll = async function (check, context, event, ...args) {
      const rollActor = context?.actor || this?.actor
      const calledShotsEnabled = game.settings.get(
         MODULE_ID,
         "enableCalledShots",
      )

      if (
         calledShotsEnabled &&
         context?.type === "saving-throw" &&
         !context.rntSaveResolved
      ) {
         const saveType = context.domains?.find((d) =>
            ["fortitude", "reflex", "will"].includes(d),
         )
         if (saveType && rollActor) {
            const parts = rollActor.getFlag(MODULE_ID, "parts") || []
            const alivePartsWithSave = parts.filter(
               (p) => p.hp.value > 0 && p.saves?.[saveType]?.enabled,
            )

            if (alivePartsWithSave.length > 0) {
               return new Promise((resolve) => {
                  new CalledShotTargetApp({
                     actor: rollActor,
                     parts: alivePartsWithSave,
                     isSave: true,
                     saveType,
                     resolve: async (result) => {
                        context.rntSaveResolved = true
                        if (result && result.type === "part") {
                           const partMod = result.part.saves[saveType].value
                           const baseMod =
                              check.modifiers?.reduce(
                                 (sum, m) => sum + (m.modifier || 0),
                                 0,
                              ) || 0
                           const diff = partMod - baseMod

                           if (diff !== 0) {
                              const rntMod = new game.pf2e.Modifier({
                                 slug: "rnt-body-part-save",
                                 label: `${result.part.name} Save`,
                                 modifier: diff,
                                 type: "untyped",
                              })

                              if (typeof check.push === "function") {
                                 check.push(rntMod)
                              } else if (Array.isArray(check.modifiers)) {
                                 check.modifiers.push(rntMod)
                              }
                           }
                        }
                        resolve(
                           await originalCheckRoll.call(
                              this,
                              check,
                              context,
                              event,
                              ...args,
                           ),
                        )
                     },
                  }).render(true)
               })
            }
         }
      }

      if (
         calledShotsEnabled &&
         context?.type === "attack-roll" &&
         context?.target?.token
      ) {
         const targetTokenDoc = getTargetDoc(context.target.token)
         const parts = targetTokenDoc?.actor?.getFlag(MODULE_ID, "parts") || []
         const aliveParts = parts.filter((p) => p.hp.value > 0)

         if (
            parts.length > 0 &&
            aliveParts.length > 0 &&
            !context.rntCalledShotResolved
         ) {
            return new Promise((resolve) => {
               new CalledShotTargetApp({
                  actor: targetTokenDoc.actor,
                  parts,
                  resolve: async (result) => {
                     if (!result) return resolve(null)

                     context.rntCalledShotResolved = true
                     if (result.type === "part") {
                        if (context.options instanceof Set) {
                           context.options.add(`called-shot:${result.part.id}`)
                        } else {
                           context.options = context.options || []
                           context.options.push(`called-shot:${result.part.id}`)
                        }
                        context.dc = { value: result.part.ac }
                     }
                     resolve(
                        await originalCheckRoll.call(
                           this,
                           check,
                           context,
                           event,
                           ...args,
                        ),
                     )
                  },
               }).render(true)
            })
         }
      }
      return originalCheckRoll.call(this, check, context, event, ...args)
   }
}

function setupPreCreateChatMessageHook() {
   Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
      if (userId !== game.user.id) return

      const context = message.flags?.pf2e?.context
      if (!context) return

      if (context.type === "attack-roll") {
         const optionsArray =
            context.options instanceof Set
               ? Array.from(context.options)
               : context.options || []
         const calledShotOption = optionsArray.find((o) =>
            o.startsWith("called-shot:"),
         )

         if (calledShotOption) {
            const partId = calledShotOption.split(":")[1]
            const targetTokenDoc = getTargetDoc(context.target?.token)
            const parts =
               targetTokenDoc?.actor?.getFlag(MODULE_ID, "parts") || []
            const part = parts.find((p) => p.id === partId)

            if (part) {
               message.updateSource({
                  [`flags.${MODULE_ID}.calledShotPartId`]: part.id,
                  [`flags.${MODULE_ID}.calledShotPartName`]: part.name,
               })

               let flavor = message.flavor || ""
               const ac = context.dc?.value

               flavor = flavor.replace(
                  /(<span[^>]*data-whose="opposer"[^>]*>Target:\s*[^<]+)(<\/span>)/i,
                  `$1 [${part.name}]$2`,
               )

               if (ac !== undefined) {
                  flavor = flavor.replace(
                     /(<span[^>]*data-visibility="gm"[^>]*data-whose="opposer"[^>]*>\((?:DC|AC)\s*)\d+(\)<\/span>)/i,
                     `$1${ac}$2`,
                  )
               }

               message.updateSource({ flavor })
            }
         }
      } else if (context.type === "damage-roll") {
         const pending = game.user.getFlag(MODULE_ID, "pendingDamageCalledShot")

         const targetMatches =
            !context.target?.token ||
            pending?.targetToken === context.target?.token ||
            pending?.targetToken === context.target?.token?.uuid

         if (!pending || !targetMatches) return

         game.user.unsetFlag(MODULE_ID, "pendingDamageCalledShot")

         const damages = []
         let totalDamage = 0

         const rolls = message.rolls || []

         const iconMap = {
            acid: "fa-solid fa-vial",
            bleed: "fa-solid fa-droplet",
            bludgeoning: "fa-solid fa-hammer",
            cold: "fa-solid fa-snowflake",
            electricity: "fa-solid fa-bolt",
            fire: "fa-solid fa-fire",
            force: "fa-solid fa-sparkles",
            mental: "fa-solid fa-brain",
            piercing: "fa-solid fa-arrow-up-right-dots",
            poison: "fa-solid fa-skull-crossbones",
            slashing: "fa-solid fa-axe",
            sonic: "fa-solid fa-wave-square",
            vitality: "fa-solid fa-sun",
            void: "fa-solid fa-moon",
         }

         for (const r of rolls) {
            const rollOpts = r.options ? Array.from(r.options) : []
            const isSplashRoll =
               rollOpts.includes("splash") || rollOpts.includes("trait:splash")

            const instances = r.instances || [r]
            for (const inst of instances) {
               let amount = inst.total || 0
               const { dmgType, dmgCategory } = categorizeDamageInstance(
                  inst,
                  isSplashRoll,
               )

               if (dmgCategory === "persistent" && amount === 0) {
                  amount = resolvePersistentAmount(inst)
               }

               if (
                  amount === 0 ||
                  amount === "" ||
                  amount === null ||
                  Number.isNaN(amount)
               )
                  continue

               const label = capitalize(dmgType) || "Untyped"
               const isPersistent = dmgCategory === "persistent"
               const isSplash = dmgCategory === "splash"
               const prefix = isPersistent
                  ? "Persistent "
                  : isSplash
                    ? "Splash "
                    : ""
               const tooltip = `${prefix}${label}`.trim()
               const icon = iconMap[dmgType] || "fa-solid fa-burst"

               damages.push({
                  amount,
                  dmgType,
                  category: dmgCategory,
                  label,
                  tooltip,
                  icon,
                  isPersistent,
               })

               if (typeof amount === "number" && dmgCategory !== "persistent") {
                  totalDamage += amount
               }
            }
         }

         let targetName = "Unknown Target"
         const targetDoc = getTargetDoc(pending.targetToken)
         if (targetDoc) targetName = targetDoc.name
         ;(async () => {
            const content = await renderTemplate(
               `${TEMPLATE_BASE}/called-shot-damage.hbs`,
               {
                  targetName,
                  partName: pending.partName,
                  partId: pending.partId,
                  damages,
                  totalDamage,
               },
            )

            await ChatMessage.create({
               speaker: message.speaker,
               content,
               flavor: `<strong>Called Shot Application</strong>`,
               flags: {
                  [MODULE_ID]: {
                     isCalledShotCard: true,
                     partId: pending.partId,
                     partName: pending.partName,
                     targetName,
                     targetUuid: targetDoc?.uuid,
                     damages,
                     totalDamage,
                  },
               },
            })
         })()

         return false
      }
   })
}

function collectDamageTypesFromMessage(message) {
   const types = new Set()
   if (!message?.rolls) return types
   for (const roll of message.rolls) {
      const instances = roll.instances || [roll]
      for (const inst of instances) {
         if (inst.type) types.add(inst.type)
      }
   }
   return types
}

function setupRenderChatMessageHook() {
   if (!window.RNT_GLOBAL_APPLY_LISTENER_INSTALLED) {
      window.RNT_GLOBAL_APPLY_LISTENER_INSTALLED = true
      document.addEventListener(
         "click",
         (ev) => {
            const btn = ev.target.closest(
               'button[data-action^="apply-"], button.apply-damage, button[data-action="shield-block"]',
            )
            if (!btn) return
            const li = btn.closest("li.chat-message, li.message")
            if (!li) return
            const messageId = li.dataset.messageId
            if (!messageId) return
            const message = game.messages.get(messageId)
            if (!message) return
            const isDmg =
               message.isDamageRoll ||
               message.flags?.pf2e?.context?.type === "damage-roll"
            if (!isDmg) return
            window.RNT_PENDING_DAMAGE_SOURCE = {
               messageId,
               damageTypes: Array.from(collectDamageTypesFromMessage(message)),
               timestamp: Date.now(),
            }
         },
         true,
      )
   }

   Hooks.on("renderChatMessageHTML", (message, htmlElement) => {
      const domElement = htmlElement
      const calledShotsEnabled = game.settings.get(
         MODULE_ID,
         "enableCalledShots",
      )

      const partName = message.getFlag(MODULE_ID, "calledShotPartName")
      const partId = message.getFlag(MODULE_ID, "calledShotPartId")
      const contextType = message.flags?.pf2e?.context?.type

      if (partName && partId && contextType === "attack-roll") {
         const damageButtons = domElement.querySelectorAll(
            'button[data-action="strike-damage"], button[data-action="strike-critical"]',
         )
         damageButtons.forEach((btn) => {
            btn.addEventListener(
               "click",
               () => {
                  game.user.setFlag(MODULE_ID, "pendingDamageCalledShot", {
                     partId,
                     partName,
                     targetToken: message.flags.pf2e.context.target?.token,
                  })
               },
               { capture: true },
            )
         })
      }

      if (
         calledShotsEnabled &&
         (message.isDamageRoll ||
            message.flags?.pf2e?.context?.type === "spell-cast" ||
            domElement.querySelector('button[data-action="spell-damage"]'))
      ) {
         const damageButtons = domElement.querySelectorAll(
            'button[data-action="spell-damage"], button[data-action="damage"]',
         )
         damageButtons.forEach((btn) => {
            btn.addEventListener(
               "click",
               (e) => {
                  if (btn.dataset.rntBypassed) {
                     delete btn.dataset.rntBypassed
                     return
                  }

                  const targets = Array.from(game.user.targets)
                  if (targets.length === 0) return

                  const targetToken = targets[0]
                  const parts =
                     targetToken.actor?.getFlag(MODULE_ID, "parts") || []

                  if (parts.length === 0) return

                  e.preventDefault()
                  e.stopImmediatePropagation()

                  new CalledShotTargetApp({
                     actor: targetToken.actor,
                     parts,
                     resolve: (result) => {
                        if (result && result.type === "part") {
                           game.user.setFlag(
                              MODULE_ID,
                              "pendingDamageCalledShot",
                              {
                                 partId: result.part.id,
                                 partName: result.part.name,
                                 targetToken: targetToken.document.uuid,
                              },
                           )
                        }
                        btn.dataset.rntBypassed = "true"
                        btn.click()
                     },
                  }).render(true)
               },
               { capture: true },
            )
         })
      }

      if (message.getFlag(MODULE_ID, "isCalledShotCard")) {
         const applyButtons = domElement.querySelectorAll(
            'button[data-action="rnt-apply-damage"]',
         )
         const targetUuid = message.getFlag(MODULE_ID, "targetUuid")
         const storedDamages = message.getFlag(MODULE_ID, "damages") || []
         const cardPartId = message.getFlag(MODULE_ID, "partId")

         applyButtons.forEach((btn) => {
            btn.addEventListener(
               "click",
               async (e) => {
                  e.preventDefault()
                  e.stopPropagation()

                  const multiplier =
                     parseFloat(e.currentTarget.dataset.multiplier) || 1
                  const finalDamages = storedDamages.map((d) => {
                     let amt = d.amount
                     if (
                        typeof amt === "number" &&
                        d.category !== "persistent"
                     ) {
                        amt = Math.floor(amt * multiplier)
                     }
                     return { ...d, amount: amt }
                  })

                  const targetDoc = await fromUuid(targetUuid)
                  if (targetDoc && targetDoc.actor) {
                     new DamageBodyPartApp({
                        actor: targetDoc.actor,
                        partId: cardPartId,
                        initialDamages: finalDamages.map((fd) => ({
                           amount: fd.amount,
                           dmgType: fd.dmgType,
                           dmgCategory: fd.category,
                        })),
                     }).render(true)
                  }
               },
               { capture: true },
            )
         })
      }
   })
}

function setupCombatTurnHook() {
   Hooks.on("updateCombat", async (combat, changed, options, userId) => {
      if (!game.user.isGM) return
      if (!("turn" in changed) && !("round" in changed)) return

      const currentId = combat.combatant?.id
      if (currentId) {
         const currentCombatant = combat.combatants.get(currentId)
         if (currentCombatant && currentCombatant.actor) {
            const parts =
               currentCombatant.actor.getFlag(MODULE_ID, "parts") || []
            const m = await import("./mechanics.mjs")

            for (let p of parts) {
               if (
                  p.regrowth?.enabled &&
                  p.hp.value > 0 &&
                  p.hp.value < p.hp.max
               ) {
                  const healAmount = p.regrowth.full
                     ? p.hp.max
                     : p.regrowth.amount || 0
                  if (healAmount > 0) {
                     await m.applyBodyPartHealing(
                        currentCombatant.actor,
                        p.id,
                        healAmount,
                     )
                  }
               }
            }

            const hotEffects = currentCombatant.actor.items.filter((i) =>
               i.getFlag(MODULE_ID, "isHoT"),
            )
            for (const effect of hotEffects) {
               const hotData = effect.getFlag(MODULE_ID, "hotData")
               if (hotData && hotData.partId && hotData.amount) {
                  await m.applyBodyPartHealing(
                     currentCombatant.actor,
                     hotData.partId,
                     hotData.amount,
                  )
               }
            }
         }
      }

      const previousId = combat.previous?.combatantId
      if (previousId) {
         const previousCombatant = combat.combatants.get(previousId)
         if (previousCombatant && previousCombatant.actor) {
            const persistentEffects = previousCombatant.actor.items.filter(
               (i) => i.getFlag(MODULE_ID, "isPersistent"),
            )
            for (const effect of persistentEffects) {
               import("./apps/persistent-dialog.mjs").then((module) => {
                  new module.PersistentDamageApp({
                     actor: previousCombatant.actor,
                     token: previousCombatant.token,
                     effect,
                  }).render(true)
               })
            }
         }
      }
   })
}

export function registerCombatHooks() {
   const originalCheckRoll = game.pf2e.Check.roll
   setupSavingThrowHook(originalCheckRoll)
   setupPreCreateChatMessageHook()
   setupRenderChatMessageHook()
   setupCombatTurnHook()
}
