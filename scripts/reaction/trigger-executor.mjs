import { MODULE_ID } from "../constants.mjs"
import { createReactionChatCard } from "./chat-card.mjs"
import { damageFormulaParts } from "./damage-data.mjs"
import { emText, strongText } from "../html-format.mjs"

export async function executeTrigger(
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
      await executeDamageTrigger(trigger, rx, actor, actorToken, targets)
   } else if (
      trigger.type === "effect" ||
      trigger.type === "condition" ||
      trigger.type === "rule-element"
   ) {
      await executeConsequenceTrigger(trigger, rx, actor, targets, options)
   } else if (trigger.type === "macro" && trigger.uuid) {
      await executeMacroTrigger(trigger, rx, actor, targets, resolvedTriggerer)
   }
}

async function executeDamageTrigger(trigger, rx, actor, actorToken, targets) {
   const PF2eDamageRoll =
      window.DamageRoll ||
      game.pf2e?.DamageRoll ||
      CONFIG.Dice.rolls.find((roll) => roll.name === "DamageRoll") ||
      window.Roll
   if (!PF2eDamageRoll) return

   const roll = new PF2eDamageRoll(damageFormulaParts(trigger.damages).join(","))
   await roll.evaluate()

   const triggererNames =
      targets.length > 0
         ? targets.map((target) => target.name).join(", ")
         : game.i18n.localize(`${MODULE_ID}.noValidTarget`)
   const flavorText =
      targets.length > 0
         ? game.i18n.format(`${MODULE_ID}.reactionTriggeredAgainst`, {
              reactionName: strongText(rx.name),
              targets: triggererNames,
           })
         : game.i18n.format(`${MODULE_ID}.reactionTriggered`, {
              reactionName: strongText(rx.name),
           })

   let targetData = null
   if (
      targets.length > 0 &&
      (trigger.target === "triggerer" || trigger.target === "self")
   ) {
      const target = targets[0]
      if (target) targetData = { actor: target.actor?.uuid, token: target.uuid }
   }

   await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor, token: actorToken }),
      flavor: flavorText,
      flags: {
         pf2e: { context: { type: "damage-roll", target: targetData } },
      },
   })
}

async function executeConsequenceTrigger(trigger, rx, actor, targets, options) {
   const triggererNames = targets.map((target) => target.name).join(", ")
   const prefix = options.isDeath
      ? game.i18n.localize(`${MODULE_ID}.deathReactionLabel`)
      : game.i18n.localize(`${MODULE_ID}.damageReactionLabel`)
   const sourceName = actor.name || game.i18n.localize(`${MODULE_ID}.unknown`)
   const sourceImg = actor.img || "systems/pf2e/icons/actions/Reaction.webp"

   for (const target of targets) {
      if (!target.actor) continue

      const effectData = buildConsequenceEffectData(
         target.actor,
         trigger,
         rx,
         sourceName,
         sourceImg,
         prefix,
      )
      if (effectData.system.rules.length === 0) continue

      await target.actor.createEmbeddedDocuments("Item", [effectData])
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: game.i18n.format(
            `${MODULE_ID}.reactionAppliedConsequence`,
            {
               reactionName: strongText(rx.name),
               targets: triggererNames,
            },
         ),
      })
   }
}

function buildConsequenceEffectData(
   targetActor,
   trigger,
   rx,
   sourceName,
   sourceImg,
   prefix,
) {
   const baseName = `${sourceName}: ${prefix}`
   let finalName = baseName
   let counter = 1

   while (targetActor.items.some((item) => item.name === finalName)) {
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
         description: {
            value: game.i18n.format(`${MODULE_ID}.reactionAppliedBy`, {
               name: rx.name,
            }),
         },
         duration: durationData,
         rules: [],
      },
   }

   addConsequenceRule(effectData, trigger)
   return effectData
}

function addConsequenceRule(effectData, trigger) {
   if (trigger.type === "condition" && trigger.slug) {
      const conditionBase = game.pf2e.ConditionManager.getCondition(
         trigger.slug,
      )
      if (!conditionBase) return
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
   } else if (trigger.type === "effect" && trigger.uuid) {
      effectData.system.rules.push({
         key: "GrantItem",
         uuid: trigger.uuid,
         onDeleteActions: { grantee: "restrict" },
      })
   } else if (trigger.type === "rule-element" && trigger.json) {
      try {
         effectData.system.rules.push(JSON.parse(trigger.json))
      } catch (_err) {
         ui.notifications.warn(
            game.i18n.localize(`${MODULE_ID}.invalidRuleElementJson`),
         )
      }
   }
}

async function executeMacroTrigger(
   trigger,
   rx,
   actor,
   targets,
   resolvedTriggerer,
) {
   const triggererNames = targets.map((target) => target.name).join(", ")
   const macro = await fromUuid(trigger.uuid)
   if (!macro || macro.documentName !== "Macro") return

   macro.execute({
      actor,
      reaction: rx,
      targets,
      triggerer: resolvedTriggerer,
   })
   ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: game.i18n.format(`${MODULE_ID}.reactionExecutedMacro`, {
         reactionName: strongText(rx.name),
         macroName: emText(macro.name),
         targets: triggererNames,
      }),
   })
}
