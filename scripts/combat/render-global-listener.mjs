import { MODULE_ID } from "../constants.mjs"
import {
   applyCalledShotDamageFromMessage,
   collectDamageTypesFromMessage,
   getApplyButtonTargetUuid,
} from "./damage-message.mjs"
import { renderDialogMessage } from "../dialogs/content.mjs"
import { renderConsequenceDamageFlavor } from "./chat-flavor.mjs"

export function installGlobalApplyListener() {
   if (!window.RNT_GLOBAL_APPLY_LISTENER_INSTALLED) {
      window.RNT_GLOBAL_APPLY_LISTENER_INSTALLED = true
      document.addEventListener(
         "click",
         async (ev) => {
            const reactionSaveBtn = ev.target.closest(".rnt-reaction-roll-save")
            if (reactionSaveBtn) {
               ev.preventDefault()
               ev.stopPropagation()
               const li = reactionSaveBtn.closest(".chat-message")
               const row = reactionSaveBtn.closest(".target-row")
               const targetUuid = row.dataset.targetUuid
               const statistic = reactionSaveBtn.dataset.statistic
               const dc = parseInt(reactionSaveBtn.dataset.dc, 10)
               const messageId = li.dataset.messageId
               const msg = game.messages.get(messageId)
               const triggerData = msg?.getFlag(MODULE_ID, "triggerData")
               const isDeathReaction = msg?.getFlag(
                  MODULE_ID,
                  "isDeathReaction",
               )
               const degreeSpan = reactionSaveBtn.querySelector(".degree")

               fromUuid(targetUuid).then(async (tDoc) => {
                  if (!tDoc || !tDoc.actor) return

                  const rollSave = async (rollMode) => {
                     const save = tDoc.actor.saves?.[statistic]
                     if (!save?.roll) {
                        ui.notifications.warn(
                           game.i18n.localize(`${MODULE_ID}.cannotRollSave`),
                        )
                        return
                     }

                     const saveRoll = await save.roll({
                        dc: { value: dc },
                        createMessage: false,
                        extraRollOptions: ["skip-rnt-called-shot"],
                     })

                     if (!saveRoll) return

                     const dosVal =
                        saveRoll.degreeOfSuccess?.value ??
                        saveRoll.degreeOfSuccess
                     const dosClasses = [
                        "critical-failure",
                        "failure",
                        "success",
                        "critical-success",
                     ]
                     const dosLabel = dosClasses[dosVal]

                     row.dataset.rolled = "true"
                     if (degreeSpan) {
                        degreeSpan.textContent = saveRoll.total
                        degreeSpan.className = `degree show ${dosLabel}`
                        degreeSpan.classList.remove("hidden")
                     }

                     if (dosLabel === "critical-success") {
                        row.classList.add("crit-success-row")
                     } else {
                        row.classList.remove("crit-success-row")
                     }

                     const dmgSection = row.querySelector(".damage-application")
                     if (dmgSection) {
                        dmgSection.classList.remove("hidden")
                        dmgSection.classList.add(dosLabel)
                     }

                     if (triggerData && triggerData.saveActions) {
                        const keyMap = {
                           3: "criticalSuccess",
                           2: "success",
                           1: "failure",
                           0: "criticalFailure",
                        }
                        const actionKey = keyMap[dosVal]
                        const dosActions =
                           triggerData.saveActions[actionKey] || []

                        const existingEffect = tDoc.actor.items.find(
                           (i) =>
                              i.getFlag(MODULE_ID, "reactionConsequenceMsg") ===
                              messageId,
                        )
                        if (existingEffect) await existingEffect.delete()

                        if (dosActions.length > 0) {
                           const sourceActor = game.actors.get(
                              msg.speaker?.actor,
                           )
                           const sourceName =
                              sourceActor?.name ||
                              msg.speaker?.alias ||
                              game.i18n.localize(`${MODULE_ID}.unknown`)
                           const sourceImg =
                              sourceActor?.img ||
                              "systems/pf2e/icons/actions/Reaction.webp"

                           const prefix = isDeathReaction
                              ? game.i18n.localize(
                                   `${MODULE_ID}.deathReactionLabel`,
                                )
                              : game.i18n.localize(
                                   `${MODULE_ID}.damageReactionLabel`,
                                )
                           let baseName = `${sourceName}: ${prefix}`
                           let finalName = baseName
                           let counter = 1

                           while (
                              tDoc.actor.items.some((i) => i.name === finalName)
                           ) {
                              finalName = `${baseName} (${++counter})`
                           }

                           const dVal = parseInt(triggerData.durationValue)
                           const dUnit = triggerData.durationUnit || "unlimited"
                           const durationData =
                              !isNaN(dVal) && dVal > 0 && dUnit !== "unlimited"
                                 ? {
                                      value: dVal,
                                      unit: dUnit,
                                      expiry: triggerData.expiry || "turn-end",
                                   }
                                 : { value: -1, unit: "unlimited" }

                           const effectData = {
                              name: finalName,
                              type: "effect",
                              img: sourceImg,
                              system: {
                                 description: {
                                    value: game.i18n.localize(
                                       `${MODULE_ID}.consequenceEffectDescription`,
                                    ),
                                 },
                                 duration: durationData,
                                 rules: [],
                              },
                              flags: {
                                 [MODULE_ID]: {
                                    reactionConsequenceMsg: messageId,
                                 },
                              },
                           }

                           for (const act of dosActions) {
                              if (act.type === "effect" && act.uuid) {
                                 effectData.system.rules.push({
                                    key: "GrantItem",
                                    uuid: act.uuid,
                                    onDeleteActions: { grantee: "restrict" },
                                 })
                              } else if (act.type === "condition" && act.slug) {
                                 const conditionBase =
                                    game.pf2e.ConditionManager.getCondition(
                                       act.slug,
                                    )
                                 if (conditionBase) {
                                    effectData.system.rules.push({
                                       key: "GrantItem",
                                       uuid:
                                          conditionBase.sourceId ||
                                          conditionBase.uuid,
                                       onDeleteActions: { grantee: "restrict" },
                                       alterations:
                                          act.value > 1
                                             ? [
                                                  {
                                                     mode: "override",
                                                     property: "badge-value",
                                                     value: act.value,
                                                  },
                                               ]
                                             : [],
                                    })
                                 }
                              } else if (
                                 act.type === "rule-element" &&
                                 act.json
                              ) {
                                 try {
                                    effectData.system.rules.push(
                                       JSON.parse(act.json),
                                    )
                                 } catch (e) {
                                    ui.notifications.warn(
                                       game.i18n.localize(
                                          `${MODULE_ID}.invalidRuleElementJson`,
                                       ),
                                    )
                                 }
                              } else if (act.type === "macro" && act.uuid) {
                                 const mac = await fromUuid(act.uuid)
                                 if (mac)
                                    mac.execute({
                                       actor: msg.actor,
                                       target: tDoc,
                                       trigger: triggerData,
                                    })
                              }
                           }
                           if (effectData.system.rules.length > 0) {
                              await tDoc.actor.createEmbeddedDocuments("Item", [
                                 effectData,
                              ])
                           }

                           const consequenceDamages = dosActions.filter(
                              (a) => a.type === "damage",
                           )
                           if (consequenceDamages.length > 0) {
                              const PF2eDamageRoll =
                                 window.DamageRoll ||
                                 game.pf2e?.DamageRoll ||
                                 CONFIG.Dice.rolls.find(
                                    (r) => r.name === "DamageRoll",
                                 ) ||
                                 window.Roll
                              if (PF2eDamageRoll) {
                                 const parts = consequenceDamages.map((d) => {
                                    const num = d.diceNum || 0
                                    const formula = d.diceStep
                                       ? `${num}d${d.diceStep}`
                                       : `${num}`
                                    const tags = []
                                    if (d.dmgType === "bleed")
                                       tags.push("persistent", "bleed")
                                    else {
                                       if (d.dmgCategory === "persistent")
                                          tags.push("persistent")
                                       else if (d.dmgCategory)
                                          tags.push(d.dmgCategory)
                                       if (d.dmgType) tags.push(d.dmgType)
                                    }
                                    const tagStr =
                                       tags.length > 0
                                          ? `[${tags.join(",")}]`
                                          : ""
                                    return `${formula}${tagStr}`
                                 })

                                 if (parts.length > 0) {
                                    const roll = new PF2eDamageRoll(
                                       parts.join(","),
                                    )
                                    await roll.evaluate()

                                    const flavor =
                                       await renderConsequenceDamageFlavor({
                                          sourceName,
                                          targetName: tDoc.name,
                                       })

                                    const previousTargets = Array.from(
                                       game.user.targets,
                                    )
                                    previousTargets.forEach((t) =>
                                       t.setTarget(false, {
                                          releaseOthers: false,
                                       }),
                                    )
                                    if (tDoc.object)
                                       tDoc.object.setTarget(true, {
                                          releaseOthers: false,
                                       })

                                    await roll.toMessage({
                                       speaker: ChatMessage.getSpeaker({
                                          actor: sourceActor,
                                       }),
                                       flavor: flavor,
                                       flags: {
                                          pf2e: {
                                             context: {
                                                type: "damage-roll",
                                                sourceType: "save",
                                                target: {
                                                   token: tDoc.uuid,
                                                   actor: tDoc.actor?.uuid,
                                                },
                                             },
                                          },
                                       },
                                    })

                                    if (tDoc.object)
                                       tDoc.object.setTarget(false, {
                                          releaseOthers: false,
                                       })
                                    previousTargets.forEach((t) =>
                                       t.setTarget(true, {
                                          releaseOthers: false,
                                       }),
                                    )
                                 }
                              }
                           }
                        }
                     }
                  }

                  if (row.dataset.rolled === "true") {
                     foundry.applications.api.DialogV2.wait({
                        window: {
                           title: game.i18n.localize(
                              `${MODULE_ID}.rerollSaveTitle`,
                           ),
                        },
                        content: await renderDialogMessage(
                           game.i18n.localize(`${MODULE_ID}.rerollSavePrompt`),
                        ),
                        buttons: [
                           {
                              action: "new",
                              label: game.i18n.localize(`${MODULE_ID}.keepNew`),
                           },
                           {
                              action: "lower",
                              label: game.i18n.localize(
                                 `${MODULE_ID}.keepLower`,
                              ),
                           },
                           {
                              action: "higher",
                              label: game.i18n.localize(
                                 `${MODULE_ID}.keepHigher`,
                              ),
                           },
                           {
                              action: "cancel",
                              label: game.i18n.localize(`${MODULE_ID}.cancel`),
                           },
                        ],
                     }).then((choice) => {
                        if (choice && choice !== "cancel") rollSave(choice)
                     })
                  } else {
                     rollSave()
                  }
               })
               return
            }
            const reactApplyBtn = ev.target.closest(
               '.rnt-reaction-card button[data-action="target-applyDamage"]',
            )
            if (reactApplyBtn) {
               ev.preventDefault()
               ev.stopPropagation()

               const li = reactApplyBtn.closest(".chat-message")
               const row = reactApplyBtn.closest(".target-row")
               const targetUuid = row.dataset.targetUuid
               const msg = game.messages.get(li.dataset.messageId)
               const damages = msg?.getFlag(MODULE_ID, "damages") || []
               let multiplier =
                  parseFloat(reactApplyBtn.dataset.multiplier) || 1

               fromUuid(targetUuid).then(async (tDoc) => {
                  if (!tDoc || !tDoc.actor) return

                  const PF2eDamageRoll =
                     window.DamageRoll ||
                     game.pf2e?.DamageRoll ||
                     CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ||
                     window.Roll
                  if (!PF2eDamageRoll) return

                  const parts = damages
                     .map((d) => {
                        const amt = Math.floor(d.amount * multiplier)
                        if (amt <= 0) return null
                        const tags = []
                        if (d.dmgType === "bleed")
                           tags.push("persistent", "bleed")
                        else {
                           if (d.dmgCategory === "persistent")
                              tags.push("persistent")
                           else if (d.dmgCategory) tags.push(d.dmgCategory)
                           if (d.dmgType) tags.push(d.dmgType)
                        }
                        const tagStr =
                           tags.length > 0 ? `[${tags.join(",")}]` : ""
                        return `${amt}${tagStr}`
                     })
                     .filter((p) => p !== null)

                  if (parts.length === 0) {
                     ui.notifications.info(
                        game.i18n.localize(`${MODULE_ID}.damageReducedToZero`),
                     )
                     return
                  }

                  const roll = new PF2eDamageRoll(parts.join(","))
                  await roll.evaluate()

                  await tDoc.actor.applyDamage({
                     damage: roll,
                     token: tDoc.object,
                     rollOptions: new Set(["damage"]),
                     skipIWR: false,
                  })
               })
               return
            }
            const btn = ev.target.closest(
               'button[data-action^="apply"], button.apply-damage, a[data-action^="apply"], a.apply-damage, button[data-action="shield-block"], button[data-action="merge-damage"], button[data-action="inject-damage"], a[data-action="shield-block"], a[data-action="merge-damage"], a[data-action="inject-damage"]',
            )
            if (!btn) return
            const li = btn.closest("li.chat-message, li.message")
            if (!li) return
            const messageId = li.dataset.messageId
            if (!messageId) return
            const message = game.messages.get(messageId)
            if (!message) return

            if (
               btn.dataset.action === "merge-damage" ||
               btn.dataset.action === "inject-damage"
            ) {
               const cpId = message.getFlag(MODULE_ID, "calledShotPartId")
               const cpName = message.getFlag(MODULE_ID, "calledShotPartName")
               const targetUuid =
                  message.getFlag(MODULE_ID, "targetUuid") ||
                  message.flags?.pf2e?.context?.target?.token
               if (cpId) {
                  const pendingData = {
                     partId: cpId,
                     partName: cpName,
                     targetToken: targetUuid,
                  }
                  window.rntPendingCalledShot = pendingData
                  game.user.setFlag(
                     MODULE_ID,
                     "pendingDamageCalledShot",
                     pendingData,
                  )
               }
            }

            const isDmg =
               message.isDamageRoll ||
               message.flags?.pf2e?.context?.type === "damage-roll" ||
               message.flags?.["pf2e-toolbelt"]?.mergeDamage?.merged
            if (!isDmg) return

            const action = btn.dataset.action || ""
            const isApplyDamage =
               action.startsWith("apply-") ||
               action.startsWith("apply") ||
               action === "apply-damage" ||
               btn.classList.contains("apply-damage")
            const isUtilityDamageAction = [
               "shield-block",
               "merge-damage",
               "inject-damage",
            ].includes(action)

            if (
               isApplyDamage &&
               !isUtilityDamageAction &&
               message.getFlag(MODULE_ID, "calledShotPartId")
            ) {
               ev.preventDefault()
               ev.stopPropagation()
               ev.stopImmediatePropagation()
               const applied = await applyCalledShotDamageFromMessage(
                  message,
                  btn,
               )
               if (!applied)
                  ui.notifications.warn(
                     game.i18n.localize(
                        `${MODULE_ID}.couldNotApplyCalledShotDamage`,
                     ),
                  )
               return
            }

            if (typeof collectDamageTypesFromMessage === "function") {
               window.RNT_PENDING_DAMAGE_SOURCE = {
                  messageId,
                  damageTypes: Array.from(
                     collectDamageTypesFromMessage(message),
                  ),
                  timestamp: Date.now(),
               }
            }
         },
         true,
      )
   }


}
