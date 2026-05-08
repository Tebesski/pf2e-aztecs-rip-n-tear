import { MODULE_ID } from "./constants.mjs"
import { playSfx } from "./sfx.mjs"

const DOS_MAP = {
   3: "criticalSuccess",
   2: "success",
   1: "failure",
   0: "criticalFailure",
}

function getDamageRollClass() {
   return (
      window.DamageRoll ||
      game.pf2e?.DamageRoll ||
      CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ||
      window.Roll
   )
}

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

function formatDamagePart(d, dosValue) {
   const num = d.diceNum || 0
   const formulaBase = d.diceStep ? `${num}d${d.diceStep}` : `${num}`
   const tags = buildDamageTags(d)
   const tagStr = tags.length > 0 ? `[${tags.join(",")}]` : ""

   let finalFormula = formulaBase
   if (dosValue === 2) finalFormula = `(${formulaBase} * 0.5)`
   else if (dosValue === 0) finalFormula = `(${formulaBase} * 2)`

   return `${finalFormula}${tagStr}`
}

function buildMessageData(actor, actorToken, flavor, target = null) {
   const msgData = {
      speaker: ChatMessage.getSpeaker({ actor, token: actorToken }),
      flavor,
      flags: { pf2e: { context: { type: "damage-roll" } } },
   }
   if (target) {
      msgData.flags.pf2e.target = target
      msgData.flags.pf2e.context.target = target
   }
   return msgData
}

export function registerReactionHooks() {
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
         if (pending && Date.now() - pending.timestamp < 3000) {
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
               return isDamage && matches && Date.now() - m.timestamp < 2000
            })

            if (recentDamageMsg && recentDamageMsg.rolls) {
               for (const roll of recentDamageMsg.rolls) {
                  const instances = roll.instances || [roll]
                  for (const inst of instances) {
                     if (inst.type) takenDamageTypes.add(inst.type)
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
         if (trigger.type !== "damage") {
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
) {
   if (trigger.type === "saving-throw") {
      await runSavingThrowTrigger(
         trigger,
         rx,
         actor,
         actorToken,
         targets,
         resolvedTriggerer,
      )
   } else if (trigger.type === "damage" && trigger.damages?.length > 0) {
      await runDamageTrigger(trigger, rx, actor, actorToken, targets)
   } else if (trigger.type === "effect" && trigger.uuid) {
      const triggererNames = targets.map((t) => t.name).join(", ")
      for (const t of targets) {
         if (!t.actor) continue
         const item = await fromUuid(trigger.uuid)
         if (item && item.type === "effect") {
            await t.actor.createEmbeddedDocuments("Item", [item.toObject()])
            ChatMessage.create({
               speaker: ChatMessage.getSpeaker({ actor }),
               content: `<strong>${rx.name}</strong> applied ${item.name} to ${triggererNames}.`,
            })
         }
      }
   } else if (trigger.type === "condition" && trigger.slug) {
      const triggererNames = targets.map((t) => t.name).join(", ")
      for (const t of targets) {
         if (!t.actor) continue
         const conditionBase = game.pf2e.ConditionManager.getCondition(
            trigger.slug,
         )
         if (!conditionBase) continue
         const conditionData = conditionBase.toObject()
         if (trigger.value > 1) {
            conditionData.system.value = {
               isValued: true,
               value: trigger.value,
            }
         }
         await t.actor.createEmbeddedDocuments("Item", [conditionData])
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<strong>${rx.name}</strong> applied condition to ${triggererNames}.`,
         })
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

async function runSavingThrowTrigger(
   trigger,
   rx,
   actor,
   actorToken,
   targets,
   resolvedTriggerer,
) {
   const saveType = trigger.saveType || "reflex"
   const dc = parseInt(trigger.dc) || 15
   const opts = trigger.rollOptions
      ? trigger.rollOptions
           .split(",")
           .map((s) => s.trim())
           .filter((s) => s)
      : []

   for (const tDoc of targets) {
      if (!tDoc.actor) continue

      Array.from(game.user.targets).forEach((t) =>
         t.setTarget(false, { releaseOthers: false }),
      )
      if (tDoc.object) {
         tDoc.object.setTarget(true, { releaseOthers: false })
      }

      let save = null
      try {
         save = await tDoc.actor.saves[saveType].roll({
            dc: { value: dc },
            extraRollOptions: opts,
            createMessage: true,
         })
      } catch (err) {
         console.error("Rip & Tear | Saving Throw roll failed", err)
         continue
      }
      if (!save) continue

      const dosValue = save.degreeOfSuccess?.value ?? save.degreeOfSuccess
      if (dosValue === undefined || dosValue === null) continue

      if (
         trigger.isBasicSave &&
         trigger.basicDamages?.length > 0 &&
         dosValue !== 3
      ) {
         const PF2eDamageRoll = getDamageRollClass()
         if (PF2eDamageRoll) {
            const parts = trigger.basicDamages.map((d) =>
               formatDamagePart(d, dosValue),
            )
            const roll = new PF2eDamageRoll(parts.join(","))
            await roll.evaluate()

            const target = tDoc.actor
               ? { actor: tDoc.actor.uuid, token: tDoc.uuid }
               : null
            await roll.toMessage(
               buildMessageData(
                  actor,
                  actorToken,
                  `<strong>${rx.name}</strong> basic save consequence against ${tDoc.name}!`,
                  target,
               ),
            )
         }
      }

      const dosKey = DOS_MAP[dosValue]
      const matchingActions = trigger.saveActions?.[dosKey] || []

      for (const action of matchingActions) {
         await runSaveAction(action, rx, actor, actorToken, tDoc)
      }
   }
}

async function runSaveAction(action, rx, actor, actorToken, tDoc) {
   if (action.type === "damage") {
      const PF2eDamageRoll = getDamageRollClass()
      if (!PF2eDamageRoll) return

      const num = action.diceNum || 0
      const formula = action.diceStep ? `${num}d${action.diceStep}` : `${num}`
      const tags = buildDamageTags(action)
      const tagStr = tags.length > 0 ? `[${tags.join(",")}]` : ""
      const roll = new PF2eDamageRoll(`${formula}${tagStr}`)
      await roll.evaluate()

      const target = tDoc.actor
         ? { actor: tDoc.actor.uuid, token: tDoc.uuid }
         : null
      await roll.toMessage(
         buildMessageData(
            actor,
            actorToken,
            `<strong>${rx.name}</strong> consequence against ${tDoc.name}!`,
            target,
         ),
      )
   } else if (action.type === "effect" && action.uuid) {
      const item = await fromUuid(action.uuid)
      if (item && item.type === "effect") {
         await tDoc.actor.createEmbeddedDocuments("Item", [item.toObject()])
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<strong>${rx.name}</strong> applied ${item.name} to ${tDoc.name}.`,
         })
      }
   } else if (action.type === "condition" && action.slug) {
      const conditionBase = game.pf2e.ConditionManager.getCondition(action.slug)
      if (!conditionBase) return
      const conditionData = conditionBase.toObject()
      if (action.value > 1) {
         conditionData.system.value = { isValued: true, value: action.value }
      }
      await tDoc.actor.createEmbeddedDocuments("Item", [conditionData])
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: `<strong>${rx.name}</strong> applied condition to ${tDoc.name}.`,
      })
   } else if (action.type === "macro" && action.uuid) {
      const macro = await fromUuid(action.uuid)
      if (macro && macro.documentName === "Macro") {
         macro.execute({ actor, reaction: rx, targets: [tDoc] })
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<strong>${rx.name}</strong> executed macro <em>${macro.name}</em> against ${tDoc.name}.`,
         })
      }
   }
}

async function runDamageTrigger(trigger, rx, actor, actorToken, targets) {
   const PF2eDamageRoll = getDamageRollClass()
   if (!PF2eDamageRoll) return

   const parts = trigger.damages.map((d) => {
      const num = d.diceNum || 0
      const formula = d.diceStep ? `${num}d${d.diceStep}` : `${num}`
      const tags = buildDamageTags(d)
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

   let target = null
   if (
      targets.length > 0 &&
      (trigger.target === "triggerer" || trigger.target === "self")
   ) {
      const tDoc = targets[0]
      if (tDoc) target = { actor: tDoc.actor?.uuid, token: tDoc.uuid }
   }

   await roll.toMessage(buildMessageData(actor, actorToken, flavorText, target))
}
