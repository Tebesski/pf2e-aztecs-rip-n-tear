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

   if (dmgType === "untyped") {
      const typeOpt = instOpts.find((o) => o.startsWith("item:damage:type:"))
      if (typeOpt) dmgType = typeOpt.split(":").pop()
   }

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

function extractDamageFromMessage(message) {
   const damages = []
   let totalDamage = 0
   const rolls = message.rolls || []

   const rollOptions = new Set(message.flags?.pf2e?.context?.options || [])
   const content = message.content || message.flavor || ""

   const materialMatches = content.matchAll(/data-material="([^"]+)"/g)
   for (const m of materialMatches) rollOptions.add(`item:material:${m[1]}`)
   const traitMatches = content.matchAll(/data-trait="([^"]+)"/g)
   for (const m of traitMatches) rollOptions.add(`item:trait:${m[1]}`)

   for (let r of rolls) {
      if (typeof r === "string") {
         try {
            r = Roll.fromJSON(r)
         } catch (e) {
            continue
         }
      }

      const rollOpts = r.options ? Array.from(r.options) : []
      rollOpts.forEach((o) => rollOptions.add(o))

      const isSplashRoll =
         rollOpts.includes("splash") ||
         rollOpts.includes("trait:splash") ||
         r.options?.flavor === "splash"

      const instances = r.instances || [r]
      for (const inst of instances) {
         let amount = inst.total || 0
         const { dmgType, dmgCategory } = categorizeDamageInstance(
            inst,
            isSplashRoll,
         )

         if (dmgCategory === "persistent" && amount === 0) {
            if (typeof resolvePersistentAmount === "function") {
               amount = resolvePersistentAmount(inst)
            }
         }

         if (
            amount === 0 ||
            amount === "" ||
            amount === null ||
            Number.isNaN(amount)
         )
            continue

         damages.push({ amount, dmgType, category: dmgCategory })
         if (typeof amount === "number" && dmgCategory !== "persistent") {
            totalDamage += amount
         }
      }
   }
   return { damages, totalDamage, rollOptions: Array.from(rollOptions) }
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
         const opts = context.options
         let skip = false
         if (opts) {
            if (opts instanceof Set && opts.has("skip-rnt-called-shot"))
               skip = true
            else if (
               Array.isArray(opts) &&
               opts.includes("skip-rnt-called-shot")
            )
               skip = true
         }

         const saveType = context.domains?.find((d) =>
            ["fortitude", "reflex", "will"].includes(d),
         )

         if (!skip && saveType && rollActor) {
            const parts = rollActor.getFlag(MODULE_ID, "parts") || []
            const validPartsWithSave = parts.filter(
               (p) =>
                  (!p.isHidden ||
                     game.user.role >= CONST.USER_ROLES.ASSISTANT) &&
                  p.saves?.[saveType]?.enabled,
            )

            if (validPartsWithSave.some((p) => p.hp.value > 0)) {
               return new Promise((resolve) => {
                  new CalledShotTargetApp({
                     actor: rollActor,
                     parts: validPartsWithSave,
                     isSave: true,
                     saveType,
                     resolve: async (result) => {
                        context.rntSaveResolved = true
                        if (result && result.type === "part") {
                           let diff = result.part.saves[saveType].adjustment

                           if (
                              diff === undefined &&
                              result.part.saves[saveType].value !== undefined
                           ) {
                              diff =
                                 result.part.saves[saveType].value -
                                 (rollActor?.saves?.[saveType]?.mod || 0)
                           }
                           diff = diff || 0

                           const rntMod = new game.pf2e.Modifier({
                              slug: "rnt-body-part-save",
                              label: `${result.part.name} Save Adj`,
                              modifier: diff,
                              type: "untyped",
                           })

                           if (typeof check.push === "function") {
                              check.push(rntMod)
                           } else if (Array.isArray(check.modifiers)) {
                              check.modifiers.push(rntMod)
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
         const validParts = parts.filter(
            (p) => !p.isHidden || game.user.role >= CONST.USER_ROLES.ASSISTANT,
         )

         if (
            parts.length > 0 &&
            validParts.some((p) => p.hp.value > 0) &&
            !context.rntCalledShotResolved
         ) {
            return new Promise((resolve) => {
               new CalledShotTargetApp({
                  actor: targetTokenDoc.actor,
                  parts: validParts,
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
                        const baseAc =
                           targetTokenDoc.actor?.system?.attributes?.ac
                              ?.value ||
                           targetTokenDoc.actor?.attributes?.ac?.value ||
                           0
                        let adj = 0
                        if (
                           result.part.acAdjustment !== undefined &&
                           result.part.acAdjustment !== null &&
                           result.part.acAdjustment !== ""
                        ) {
                           adj = Number(result.part.acAdjustment)
                        } else if (
                           result.part.ac !== undefined &&
                           result.part.ac !== null
                        ) {
                           adj = Number(result.part.ac) - baseAc
                        }
                        context.dc = { value: baseAc + adj }
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

      if (context?.type === "attack-roll") {
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
      }

      const isMerged = message.flags?.["pf2e-toolbelt"]?.mergeDamage?.merged
      const isDamage =
         message.isDamageRoll || context?.type === "damage-roll" || isMerged

      if (isDamage) {
         const pending =
            window.rntPendingCalledShot ||
            game.user.getFlag(MODULE_ID, "pendingDamageCalledShot")

         const optionsArray =
            context?.options instanceof Set
               ? Array.from(context.options)
               : context?.options || []
         const calledShotOption = optionsArray.find((o) =>
            o.startsWith("called-shot:"),
         )

         let partId =
            message.flags?.[MODULE_ID]?.calledShotPartId || pending?.partId
         let partName =
            message.flags?.[MODULE_ID]?.calledShotPartName || pending?.partName

         let targetTokenUuid =
            message.flags?.[MODULE_ID]?.targetUuid ||
            pending?.targetToken ||
            context?.target?.token ||
            message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets?.[0]

         if (!partId && calledShotOption) {
            partId = calledShotOption.split(":")[1]
         }

         const targetDoc = getTargetDoc(targetTokenUuid)
         if (targetDoc && partId && !partName) {
            const parts = targetDoc.actor?.getFlag(MODULE_ID, "parts") || []
            const part = parts.find((p) => p.id === partId)
            if (part) partName = part.name
         }

         const { damages, totalDamage, rollOptions } =
            extractDamageFromMessage(message)

         const updateData = {
            [`flags.${MODULE_ID}.damages`]: damages,
            [`flags.${MODULE_ID}.totalDamage`]: totalDamage,
            [`flags.${MODULE_ID}.rollOptions`]: rollOptions,
         }

         if (targetDoc) {
            updateData[`flags.${MODULE_ID}.targetUuid`] = targetDoc.uuid
         }

         const targetMatches =
            !targetTokenUuid ||
            !context?.target?.token ||
            targetTokenUuid === context.target.token ||
            targetTokenUuid === context.target.token?.uuid

         if (partId && targetMatches) {
            window.rntPendingCalledShot = null
            game.user.unsetFlag(MODULE_ID, "pendingDamageCalledShot")

            const updatedOptions = new Set(optionsArray)
            updatedOptions.add(`called-shot:${partId}`)

            updateData["flags.pf2e.context.options"] =
               Array.from(updatedOptions)
            updateData[`flags.${MODULE_ID}.isCalledShotDamage`] = true
            updateData[`flags.${MODULE_ID}.calledShotPartId`] = partId
            updateData[`flags.${MODULE_ID}.calledShotPartName`] = partName

            let flavor = message.flavor || ""
            if (!flavor.includes(`[${partName}]`)) {
               flavor += `<div style="font-weight:600; color:var(--rnt-accent); margin-top:4px;"><i class="fa-solid fa-crosshairs"></i> Called Shot: ${partName}</div>`
               updateData.flavor = flavor
            }
         }

         message.updateSource(updateData)
      }
   })
}

function setupRenderChatMessageHook() {
   if (!window.RNT_GLOBAL_APPLY_LISTENER_INSTALLED) {
      window.RNT_GLOBAL_APPLY_LISTENER_INSTALLED = true
      document.addEventListener(
         "click",
         (ev) => {
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
                     const saveRoll = await tDoc.actor.saves[statistic].roll({
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
                              "Unknown"
                           const sourceImg =
                              sourceActor?.img ||
                              "systems/pf2e/icons/actions/Reaction.webp"

                           const prefix = isDeathReaction
                              ? "Death Reaction"
                              : "Damage Reaction"
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
                                 description: { value: "Consequence" },
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
                                    console.error(
                                       "Rip & Tear | Invalid Rule Element JSON in reaction",
                                       e,
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

                                    const flavor = `<h4 class="action"><strong>${sourceName}</strong></h4><p>Consequence damage applied to <strong>${tDoc.name}</strong></p>`

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
                        window: { title: "Reroll Save" },
                        content: `<p>How would you like to reroll?</p>`,
                        buttons: [
                           { action: "new", label: "Keep New" },
                           { action: "lower", label: "Keep Lower" },
                           { action: "higher", label: "Keep Higher" },
                           { action: "cancel", label: "Cancel" },
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
                     ui.notifications.info("Rip & Tear: Damage reduced to 0.")
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
               'button[data-action^="apply-"], button.apply-damage, button[data-action="shield-block"], button[data-action="merge-damage"], button[data-action="inject-damage"]',
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
               applyBtn.title = "Apply to Body Part"
               applyBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i>'
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
                           "Rip & Tear: No valid damage found in this roll.",
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
                           "Rip & Tear: Target critically succeeded. No damage to apply.",
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
                              "Rip & Tear: Damage reduced to 0.",
                           )
                           return
                        }

                        const bm = await import("./apps/body-part-app.mjs")
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
                        const m = await import("./apps/called-shot-app.mjs")
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
         applyBtn.title = cpName ? `Apply to ${cpName}` : `Apply to Body Part`
         applyBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i>'

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
                     "Rip & Tear: No valid damage found in this roll.",
                  )
                  return
               }

               const openDamageApp = async (partId) => {
                  const bm = await import("./apps/body-part-app.mjs")
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
                  const m = await import("./apps/called-shot-app.mjs")
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

function collectDamageTypesFromMessage(message) {
   const types = new Set()
   const optsArray = message.flags?.pf2e?.context?.options || []
   const options = optsArray instanceof Set ? Array.from(optsArray) : optsArray
   const typeOpt = options.find((o) => o.startsWith("item:damage:type:"))
   if (typeOpt) types.add(typeOpt.split(":").pop())

   const rolls = message.rolls || []
   for (const r of rolls) {
      let rollObj = r
      if (typeof r === "string") {
         try {
            rollObj = Roll.fromJSON(r)
         } catch (e) {
            continue
         }
      }
      const instances = rollObj.instances || [rollObj]
      for (const inst of instances) {
         if (inst.type) types.add(inst.type)
      }
   }
   return types
}

function setupCombatTurnHook() {
   Hooks.on("updateCombat", async (combat, changed, options, userId) => {
      if (!game.user.isGM) return
      if (!("turn" in changed) && !("round" in changed)) return

      const previousId = combat.previous?.combatantId
      const m = await import("./mechanics.mjs")

      for (const c of combat.combatants) {
         if (!c.actor) continue

         const isRegenDisabled = c.actor.items.some((i) =>
            i.getFlag(MODULE_ID, "isRegenDisabled"),
         )
         if (isRegenDisabled) continue

         const parts = c.actor.getFlag(MODULE_ID, "parts") || []
         const isTheirTurnEnd = c.id === previousId

         for (let p of parts) {
            if (
               p.regrowth?.enabled &&
               p.hp.value > 0 &&
               p.hp.value < p.hp.max
            ) {
               if (p.regrowth.anyTurn || isTheirTurnEnd) {
                  const healAmount = p.regrowth.full
                     ? p.hp.max
                     : p.regrowth.amount || 0
                  if (healAmount > 0) {
                     await m.applyBodyPartHealing(c.actor, p.id, healAmount)
                  }
               }
            }
         }

         if (isTheirTurnEnd) {
            const hotEffects = c.actor.items.filter((i) =>
               i.getFlag(MODULE_ID, "isHoT"),
            )
            for (const effect of hotEffects) {
               const hotData = effect.getFlag(MODULE_ID, "hotData")
               if (hotData && hotData.partId && hotData.amount) {
                  await m.applyBodyPartHealing(
                     c.actor,
                     hotData.partId,
                     hotData.amount,
                  )
               }
            }
         }
      }

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
