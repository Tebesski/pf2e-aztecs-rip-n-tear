import { MODULE_ID } from "./constants.mjs"
import { playSfx } from "./sfx.mjs"

function buildDamageTags(d) {
   const tags = []
   if (d.dmgType === "bleed") {
      tags.push("persistent", "bleed")
   } else {
      if (d.dmgCategory === "persistent") tags.push("persistent")
      else if (d.dmgCategory) tags.push(d.dmgCategory)
      if (d.dmgType) tags.push(d.dmgType)
   }
   return tags
}

export function registerReactionHooks() {
   document.addEventListener(
      "click",
      (event) => {
         const button = event.target.closest(
            "button[data-action='applyDamage'], button[data-action='target-applyDamage'], button[data-action='applyHealing'], button[data-action='target-applyHealing']",
         )

         if (button) {
            const messageElement = button.closest(".chat-message")
            if (messageElement) {
               const messageId = messageElement.dataset.messageId
               const message = game.messages.get(messageId)

               if (message) {
                  const types = extractDamageTypesFromMessage(message)

                  window.RNT_PENDING_DAMAGE_SOURCE = {
                     timestamp: Date.now(),
                     damageTypes: types,
                  }
               }
            }
         }
      },
      { capture: true },
   )

   Hooks.on("preUpdateActor", (actor, updates, options, userId) => {
      if (userId !== game.user.id) return
      const newHp = foundry.utils.getProperty(
         updates,
         "system.attributes.hp.value",
      )
      if (newHp !== undefined && newHp < actor.system.attributes.hp.value) {
         options.rntDamageTaken = actor.system.attributes.hp.value - newHp
      }
      if (
         newHp !== undefined &&
         newHp <= 0 &&
         actor.system.attributes.hp.value > 0
      ) {
         options.rntDeathTriggered = true
      }
   })

   function extractDamageTypesFromMessage(message) {
      const takenDamageTypes = new Set()

      let ctxOpts = message.flags?.pf2e?.context?.options || []
      if (ctxOpts instanceof Set) ctxOpts = Array.from(ctxOpts)
      else if (!Array.isArray(ctxOpts) && typeof ctxOpts === "object")
         ctxOpts = Object.values(ctxOpts)
      else if (!Array.isArray(ctxOpts)) ctxOpts = []

      ctxOpts.forEach((o) => {
         if (typeof o === "string") {
            if (o.startsWith("item:damage:type:"))
               takenDamageTypes.add(o.split("item:damage:type:")[1])
            if (o.startsWith("item:damage:category:"))
               takenDamageTypes.add(o.split("item:damage:category:")[1])
            if (o.startsWith("damage:type:"))
               takenDamageTypes.add(o.split("damage:type:")[1])
         }
      })

      const rolls = message.rolls || []
      for (const r of rolls) {
         let rollOpts = r.options || []
         if (rollOpts instanceof Set) rollOpts = Array.from(rollOpts)
         else if (!Array.isArray(rollOpts) && typeof rollOpts === "object")
            rollOpts = Object.values(rollOpts)
         else if (!Array.isArray(rollOpts)) rollOpts = []

         rollOpts.forEach((o) => {
            if (typeof o === "string") {
               if (o.startsWith("item:damage:type:"))
                  takenDamageTypes.add(o.split("item:damage:type:")[1])
               if (o.startsWith("item:damage:category:"))
                  takenDamageTypes.add(o.split("item:damage:category:")[1])
               if (o.startsWith("damage:type:"))
                  takenDamageTypes.add(o.split("damage:type:")[1])
            }
         })

         const instances = r.instances || [r]
         for (const inst of instances) {
            if (inst.type) takenDamageTypes.add(inst.type)
            if (inst.category) takenDamageTypes.add(inst.category)
         }
      }
      return takenDamageTypes
   }

   Hooks.on("updateActor", async (actor, updates, options, userId) => {
      if (userId !== game.user.id) return

      if (options.rntDamageTaken) {
         const damageTaken =
            options.rntOriginalPartDamage || options.rntDamageTaken
         const damageSource = options.rntDamageSource || "creature"
         const partId = options.rntPartId || null

         const takenDamageTypes = new Set()
         const actorToken = actor.token ?? actor.getActiveTokens()[0]?.document

         const pending = window.RNT_PENDING_DAMAGE_SOURCE
         if (pending && Date.now() - pending.timestamp < 300000) {
            for (const t of pending.damageTypes) takenDamageTypes.add(t)
            window.RNT_PENDING_DAMAGE_SOURCE = null
         } else {
            const messages = Array.from(game.messages.contents).reverse()
            const recentDamageMsg = messages.find((m) => {
               const isDamage = m.flags?.pf2e?.context?.type === "damage-roll"
               const tToken =
                  m.flags?.pf2e?.context?.target?.token ||
                  m.flags?.pf2e?.target?.token
               const matches =
                  tToken === actorToken?.uuid || tToken === actorToken?.id
               return isDamage && matches && Date.now() - m.timestamp < 300000
            })

            if (recentDamageMsg) {
               let ctxOpts = recentDamageMsg.flags?.pf2e?.context?.options || []
               if (ctxOpts instanceof Set) ctxOpts = Array.from(ctxOpts)
               else if (!Array.isArray(ctxOpts) && typeof ctxOpts === "object")
                  ctxOpts = Object.values(ctxOpts)
               else if (!Array.isArray(ctxOpts)) ctxOpts = []

               ctxOpts.forEach((o) => {
                  if (typeof o === "string") {
                     if (o.startsWith("item:damage:type:"))
                        takenDamageTypes.add(o.split("item:damage:type:")[1])
                     if (o.startsWith("item:damage:category:"))
                        takenDamageTypes.add(
                           o.split("item:damage:category:")[1],
                        )
                     if (o.startsWith("damage:type:"))
                        takenDamageTypes.add(o.split("damage:type:")[1])
                  }
               })

               const rolls = recentDamageMsg.rolls || []
               for (const r of rolls) {
                  let rollOpts = r.options || []
                  if (rollOpts instanceof Set) rollOpts = Array.from(rollOpts)
                  else if (
                     !Array.isArray(rollOpts) &&
                     typeof rollOpts === "object"
                  )
                     rollOpts = Object.values(rollOpts)
                  else if (!Array.isArray(rollOpts)) rollOpts = []

                  rollOpts.forEach((o) => {
                     if (typeof o === "string") {
                        if (o.startsWith("item:damage:type:"))
                           takenDamageTypes.add(o.split("item:damage:type:")[1])
                        if (o.startsWith("item:damage:category:"))
                           takenDamageTypes.add(
                              o.split("item:damage:category:")[1],
                           )
                        if (o.startsWith("damage:type:"))
                           takenDamageTypes.add(o.split("damage:type:")[1])
                     }
                  })

                  const instances = r.instances || [r]
                  for (const inst of instances) {
                     if (inst.type) takenDamageTypes.add(inst.type)
                     if (inst.category) takenDamageTypes.add(inst.category)
                  }
               }
            }
         }

         if (options.rntDmgType) takenDamageTypes.add(options.rntDmgType)

         evaluateReactions(
            actor,
            damageTaken,
            takenDamageTypes,
            damageSource,
            partId,
         )
      }

      if (options.rntDeathTriggered) {
         evaluateDeathReaction(actor)
      }
   })

   Hooks.on("deleteItem", (item, options, userId) => {
      if (userId !== game.user.id) return
      if (item.getFlag(MODULE_ID, "isDelayedDeath") && item.parent) {
         const dr = item.getFlag(MODULE_ID, "deathReactionData")
         if (dr) triggerReaction(item.parent, dr, null, { isDeath: true })
      }
   })
}

export async function evaluateReactions(
   actor,
   damageTaken,
   takenDamageTypes,
   damageSource = "creature",
   damagedPartId = null,
) {
   if (!damageTaken) return
   const reactions = actor.getFlag(MODULE_ID, "reactions") || []
   if (reactions.length === 0) return

   for (const rx of reactions) {
      if (rx.disabled) continue

      const reactTo = rx.reactTo || "both"
      if (damageSource === "creature" && reactTo === "part") continue
      if (damageSource === "part" && reactTo === "creature") continue

      if (damageSource === "part" && rx.allParts === false) {
         if (!rx.specificParts || !rx.specificParts.includes(damagedPartId))
            continue
      }

      if (rx.minDamage && damageTaken < rx.minDamage) continue

      if (rx.damageTypes && rx.damageTypes.length > 0) {
         if (!takenDamageTypes || takenDamageTypes.size === 0) continue
         const hasMatchingType = rx.damageTypes.some((dt) =>
            takenDamageTypes.has(dt),
         )
         if (!hasMatchingType) continue
      }

      const effectName = `Reaction Used: ${rx.name}`
      if (actor.items.some((i) => i.name === effectName)) continue

      const reqTypes =
         rx.damageTypes && rx.damageTypes.length > 0
            ? `<br><em>(Requires: ${rx.damageTypes.join(", ")})</em>`
            : ""
      const sourceText =
         damageSource === "part" ? "a body part" : "the creature"

      if (rx.actionType === "free") {
         const promptFree = game.settings.get(MODULE_ID, "promptFreeActions")
         if (promptFree) {
            Dialog.confirm({
               title: `Trigger Free Action: ${rx.name}?`,
               content: `<p><strong>${actor.name}</strong> took ${damageTaken} damage to ${sourceText}. Trigger free action <strong>${rx.name}</strong>?${reqTypes}</p>`,
               yes: () => triggerReaction(actor, rx),
            })
         } else {
            triggerReaction(actor, rx)
         }
      } else {
         Dialog.confirm({
            title: `Trigger Reaction: ${rx.name}?`,
            content: `<p><strong>${actor.name}</strong> took ${damageTaken} damage to ${sourceText}. Trigger reaction <strong>${rx.name}</strong>?${reqTypes}</p>`,
            yes: () => triggerReaction(actor, rx),
         })
      }
   }
}

export async function evaluateDeathReaction(actor) {
   const dr = actor.getFlag(MODULE_ID, "deathReaction")
   if (!dr || dr.disabled) return

   const effectName = `Death Reaction Used: ${dr.name}`
   if (actor.items.some((i) => i.name === effectName)) return

   Dialog.confirm({
      title: `Trigger Death Reaction: ${dr.name}?`,
      content: `<p><strong>${actor.name}</strong> has reached 0 HP. Trigger death reaction <strong>${dr.name}</strong>?</p>`,
      yes: async () => {
         const effectData = {
            name: effectName,
            type: "effect",
            img: "systems/pf2e/icons/actions/Passive.webp",
            system: {
               description: { value: "This death reaction has been used." },
            },
            flags: { [MODULE_ID]: { isDeathReactionEffect: true } },
         }
         await actor.createEmbeddedDocuments("Item", [effectData])

         if (dr.useDelay) {
            const delayedData = {
               name: `Delayed Death: ${dr.name}`,
               type: "effect",
               img: "icons/svg/skull.svg",
               system: {
                  duration: {
                     value: dr.delayRounds || 1,
                     unit: "rounds",
                     expiry: dr.expiry || "turn-end",
                  },
                  description: {
                     value: "Triggering death reaction upon expiration.",
                  },
               },
               flags: {
                  [MODULE_ID]: { isDelayedDeath: true, deathReactionData: dr },
               },
            }
            await actor.createEmbeddedDocuments("Item", [delayedData])
            ChatMessage.create({
               speaker: ChatMessage.getSpeaker({ actor }),
               content: `<strong>${actor.name}</strong> initiated a delayed death reaction: <em>${dr.name}</em>.`,
            })
         } else {
            triggerReaction(actor, dr, null, { isDeath: true })
         }
      },
   })
}

export async function triggerReaction(
   actor,
   rx,
   manualTriggerer = null,
   options = {},
) {
   if (rx.actionType && rx.actionType !== "free") {
      const effectData = {
         name: `Reaction Used: ${rx.name}`,
         type: "effect",
         img: "systems/pf2e/icons/actions/Reaction.webp",
         system: {
            description: {
               value: "This reaction has been used and cannot be triggered again until the next turn.",
            },
            duration: { value: 1, unit: "rounds", expiry: "turn-start" },
         },
         flags: { [MODULE_ID]: { isReactionEffect: true } },
      }
      await actor.createEmbeddedDocuments("Item", [effectData])
   }

   if (rx.sfxTrigger) {
      const sfxType = options.isDeath ? "deathReaction" : "damageReaction"
      await playSfx(rx.sfxTrigger, sfxType)
   }

   const actorToken = actor.token ?? actor.getActiveTokens()[0]?.document

   let resolvedTriggerer = manualTriggerer
   if (!resolvedTriggerer && !options.isManual) {
      const messages = Array.from(game.messages.contents).reverse()
      const recentDamageMsg = messages.find((m) => {
         const isDamage = m.flags?.pf2e?.context?.type === "damage-roll"
         const tToken =
            m.flags?.pf2e?.context?.target?.token ||
            m.flags?.pf2e?.target?.token
         const matches =
            tToken === actorToken?.uuid || tToken === actorToken?.id
         return isDamage && matches && Date.now() - m.timestamp < 60000
      })
      if (recentDamageMsg) {
         const speakerTokenId = recentDamageMsg.speaker?.token
         if (speakerTokenId && canvas.scene) {
            resolvedTriggerer = canvas.scene.tokens.get(speakerTokenId)
         }
         if (
            !resolvedTriggerer &&
            recentDamageMsg.speaker?.actor &&
            canvas.scene
         ) {
            resolvedTriggerer = canvas.scene.tokens.find(
               (t) => t.actor?.id === recentDamageMsg.speaker.actor,
            )
         }
      }
   }

   for (const trigger of rx.triggers) {
      const targets = collectTargets(trigger, actorToken, resolvedTriggerer)

      if (targets.length === 0) {
         if (trigger.type !== "damage" && trigger.type !== "saving-throw") {
            if (options.isManual) {
               ui.notifications.warn(
                  `Reaction "${rx.name}" requires a valid target to apply an effect or condition. No targets found.`,
               )
            }
            continue
         }
      }

      if (targets.length > 0) {
         Array.from(game.user.targets).forEach((t) =>
            t.setTarget(false, { releaseOthers: false }),
         )
         targets.forEach((tDoc) => {
            if (tDoc.object)
               tDoc.object.setTarget(true, { releaseOthers: false })
         })
      }

      await executeTrigger(
         trigger,
         rx,
         actor,
         actorToken,
         targets,
         resolvedTriggerer,
         options,
      )
   }
}

function collectTargets(trigger, actorToken, resolvedTriggerer) {
   const targets = []
   if (trigger.target === "triggerer") {
      if (resolvedTriggerer) targets.push(resolvedTriggerer)
   } else if (trigger.target === "self") {
      if (actorToken) targets.push(actorToken)
   } else if (trigger.target === "aura") {
      if (!actorToken || !canvas.scene) return targets
      const sourceToken = actorToken.object || canvas.tokens.get(actorToken.id)
      if (!sourceToken) return targets

      const tokens = canvas.scene.tokens.filter((tDoc) => {
         if (tDoc.id === actorToken.id) return false
         const targetToken = tDoc.object || canvas.tokens.get(tDoc.id)
         if (!targetToken) return false

         let dist
         if (typeof sourceToken.distanceTo === "function") {
            dist = sourceToken.distanceTo(targetToken)
         } else {
            const dx = targetToken.x - sourceToken.x
            const dy = targetToken.y - sourceToken.y
            dist =
               (Math.sqrt(dx * dx + dy * dy) / canvas.dimensions.size) *
               canvas.dimensions.distance
         }
         return dist <= trigger.radius
      })

      for (const t of tokens) {
         const isEnemy = t.disposition !== actorToken.disposition
         const isAlly = t.disposition === actorToken.disposition
         if (trigger.targetFilters === "enemies" && isEnemy) targets.push(t)
         else if (trigger.targetFilters === "allies" && isAlly) targets.push(t)
         else if (trigger.targetFilters === "all") targets.push(t)
      }
   }
   return targets
}

async function executeTrigger(
   trigger,
   rx,
   actor,
   actorToken,
   targets,
   resolvedTriggerer,
   options = {},
) {
   if (trigger.type === "saving-throw") {
      await createReactionChatCard(actor, rx, trigger, targets, options)
   } else if (trigger.type === "damage" && trigger.damages?.length > 0) {
      const PF2eDamageRoll =
         window.DamageRoll ||
         game.pf2e?.DamageRoll ||
         CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ||
         window.Roll
      if (!PF2eDamageRoll) return

      const parts = trigger.damages.map((d) => {
         const num = d.diceNum || 0
         const formula = d.diceStep ? `${num}d${d.diceStep}` : `${num}`
         const tags = []
         if (d.dmgType === "bleed") tags.push("persistent", "bleed")
         else {
            if (d.dmgCategory === "persistent") tags.push("persistent")
            else if (d.dmgCategory) tags.push(d.dmgCategory)
            if (d.dmgType) tags.push(d.dmgType)
         }
         const tagStr = tags.length > 0 ? `[${tags.join(",")}]` : ""
         return `${formula}${tagStr}`
      })

      const roll = new PF2eDamageRoll(parts.join(","))
      await roll.evaluate()

      const triggererNames =
         targets.length > 0
            ? targets.map((t) => t.name).join(", ")
            : "no valid target"
      const flavorText =
         targets.length > 0
            ? `<strong>${rx.name}</strong> triggered against ${triggererNames}!`
            : `<strong>${rx.name}</strong> triggered!`

      let targetData = null
      if (
         targets.length > 0 &&
         (trigger.target === "triggerer" || trigger.target === "self")
      ) {
         const tDoc = targets[0]
         if (tDoc) targetData = { actor: tDoc.actor?.uuid, token: tDoc.uuid }
      }

      await roll.toMessage({
         speaker: ChatMessage.getSpeaker({ actor, token: actorToken }),
         flavor: flavorText,
         flags: {
            pf2e: { context: { type: "damage-roll", target: targetData } },
         },
      })
   } else if (
      trigger.type === "effect" ||
      trigger.type === "condition" ||
      trigger.type === "rule-element"
   ) {
      const triggererNames = targets.map((t) => t.name).join(", ")
      const prefix = options.isDeath ? "Death Reaction" : "Damage Reaction"
      const sourceName = actor.name || "Unknown"
      const sourceImg = actor.img || "systems/pf2e/icons/actions/Reaction.webp"

      for (const t of targets) {
         if (!t.actor) continue

         let baseName = `${sourceName}: ${prefix}`
         let finalName = baseName
         let counter = 1

         while (t.actor.items.some((i) => i.name === finalName)) {
            finalName = `${baseName} (${++counter})`
         }

         const dVal = parseInt(trigger.durationValue)
         const dUnit = trigger.durationUnit || "unlimited"
         const durationData =
            !isNaN(dVal) && dVal > 0 && dUnit !== "unlimited"
               ? {
                    value: dVal,
                    unit: dUnit,
                    expiry: trigger.expiry || "turn-end",
                 }
               : { value: -1, unit: "unlimited" }

         const effectData = {
            name: finalName,
            type: "effect",
            img: sourceImg,
            system: {
               description: { value: `Applied by ${rx.name}` },
               duration: durationData,
               rules: [],
            },
         }

         if (trigger.type === "condition" && trigger.slug) {
            const conditionBase = game.pf2e.ConditionManager.getCondition(
               trigger.slug,
            )
            if (conditionBase) {
               effectData.system.rules.push({
                  key: "GrantItem",
                  uuid: conditionBase.sourceId || conditionBase.uuid,
                  onDeleteActions: { grantee: "restrict" },
                  alterations:
                     trigger.value > 1
                        ? [
                             {
                                mode: "override",
                                property: "badge-value",
                                value: trigger.value,
                             },
                          ]
                        : [],
               })
            }
         } else if (trigger.type === "effect" && trigger.uuid) {
            effectData.system.rules.push({
               key: "GrantItem",
               uuid: trigger.uuid,
               onDeleteActions: { grantee: "restrict" },
            })
         } else if (trigger.type === "rule-element" && trigger.json) {
            try {
               effectData.system.rules.push(JSON.parse(trigger.json))
            } catch (e) {
               console.error(
                  "Rip & Tear | Invalid Rule Element JSON in reaction",
                  e,
               )
            }
         }

         if (effectData.system.rules.length > 0) {
            await t.actor.createEmbeddedDocuments("Item", [effectData])
            ChatMessage.create({
               speaker: ChatMessage.getSpeaker({ actor }),
               content: `<strong>${rx.name}</strong> applied consequence to ${triggererNames}.`,
            })
         }
      }
   } else if (trigger.type === "macro" && trigger.uuid) {
      const triggererNames = targets.map((t) => t.name).join(", ")
      const macro = await fromUuid(trigger.uuid)
      if (macro && macro.documentName === "Macro") {
         macro.execute({
            actor,
            reaction: rx,
            targets,
            triggerer: resolvedTriggerer,
         })
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<strong>${rx.name}</strong> executed macro <em>${macro.name}</em> against ${triggererNames}.`,
         })
      }
   }
}

export async function createReactionChatCard(
   actor,
   reaction,
   trigger,
   targets,
   options = {},
) {
   const saveType = trigger.saveType || "reflex"
   const saveDc = parseInt(trigger.dc) || 15
   const dmgList = trigger.isBasicSave ? trigger.basicDamages : trigger.damages
   const hasDamage = dmgList && dmgList.length > 0

   let damageFormula = ""
   let damageTotal = 0
   let evaluatedDamages = []

   if (hasDamage && dmgList && dmgList.length > 0) {
      const PF2eDamageRoll =
         window.DamageRoll ||
         game.pf2e?.DamageRoll ||
         CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ||
         window.Roll
      if (PF2eDamageRoll) {
         const parts = dmgList.map((d) => {
            const num = d.diceNum || 0
            const formula = d.diceStep ? `${num}d${d.diceStep}` : `${num}`
            const tags = []
            if (d.dmgType === "bleed") tags.push("persistent", "bleed")
            else {
               if (d.dmgCategory === "persistent") tags.push("persistent")
               else if (d.dmgCategory) tags.push(d.dmgCategory)
               if (d.dmgType) tags.push(d.dmgType)
            }
            const tagStr = tags.length > 0 ? `[${tags.join(",")}]` : ""
            return `${formula}${tagStr}`
         })

         if (parts.length > 0) {
            const roll = new PF2eDamageRoll(parts.join(","))
            await roll.evaluate()
            damageFormula = roll.formula
            damageTotal = roll.total

            const iconMap = {
               acid: "fa-flask",
               bleed: "fa-droplet",
               bludgeoning: "fa-hammer",
               cold: "fa-snowflake",
               electricity: "fa-bolt",
               fire: "fa-fire",
               force: "fa-sparkles",
               mental: "fa-brain",
               piercing: "fa-bow-arrow",
               poison: "fa-vial",
               slashing: "fa-axe",
               sonic: "fa-wave-square",
               vitality: "fa-sun",
               void: "fa-skull",
               spirit: "fa-ghost",
               holy: "fa-cross",
               unholy: "fa-pentagram",
               untyped: "fa-burst",
            }

            const instances = roll.instances || [roll]
            for (const inst of instances) {
               const dType = inst.type || "untyped"
               const cat = inst.category || ""
               evaluatedDamages.push({
                  amount: inst.total,
                  dmgType: dType,
                  icon: iconMap[dType] || "fa-burst",
                  isPersistent: cat === "persistent",
                  isPrecision: cat === "precision",
                  isSplash: cat === "splash",
               })
            }
         }
      }
   }

   const targetData = (targets || []).map((t) => ({
      uuid: t.document ? t.document.uuid : t.uuid,
      name: t.name,
   }))

   const templateData = {
      actor: { id: actor.id, name: actor.name },
      reaction: {
         id: reaction.id,
         name: reaction.name,
         img: reaction.img || "icons/svg/explosion.svg",
      },
      hasSave: true,
      saveType,
      saveDc,
      hasDamage,
      evaluatedDamages,
      damageTotal,
      targets: targetData,
   }

   const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/reaction-chat-card.hbs`,
      templateData,
   )

   await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: content,
      flags: {
         [MODULE_ID]: {
            isReactionCard: true,
            reactionData: reaction,
            triggerData: trigger,
            damages: evaluatedDamages,
            totalDamage: damageTotal,
            isDeathReaction: options.isDeath || false,
         },
      },
   })
}
