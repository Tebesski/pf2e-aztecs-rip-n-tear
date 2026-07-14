import { MODULE_ID } from "../constants.mjs"
import { RntThresholdDamageCardManager } from "../threshold-damage-card.mjs"
import {
   getRntThresholdTargetData,
   normalizeRntThresholdTargets,
   resolveRntThresholdTargetActors,
   syncRntDisabledModules,
} from "../actor-support.mjs"
import {
   createParentEffectsData,
   effectTargetIdsForThresholds,
} from "./threshold-effects-data.mjs"

function isThresholdEffectForSourcePart(item, sourceActor, partId) {
   if (!item?.getFlag?.(MODULE_ID, "isBodyPartEffect")) return false
   if (item.getFlag(MODULE_ID, "partId") !== partId) return false

   const sourceUuid = item.getFlag(MODULE_ID, "thresholdSourceActorUuid")
   const sourceId = item.getFlag(MODULE_ID, "thresholdSourceActorId")
   if (sourceUuid || sourceId) {
      return sourceUuid === sourceActor.uuid || sourceId === sourceActor.id
   }

   const parent = item.parent
   if (parent?.uuid === sourceActor.uuid || parent?.id === sourceActor.id)
      return true
   return sourceActor?.type === "vehicle"
}

function getActorsWithThresholdEffectsForPart(sourceActor, partId) {
   const actors = new Map()
   const addActor = (actor) => {
      if (!actor) return
      const key = actor.uuid || actor.id
      if (key) actors.set(key, actor)
   }

   addActor(sourceActor)
   for (const actor of globalThis.game?.actors || []) addActor(actor)
   for (const token of globalThis.canvas?.tokens?.placeables || [])
      addActor(token.actor)

   return Array.from(actors.values()).filter((actor) =>
      actor.items?.some((item) =>
         isThresholdEffectForSourcePart(item, sourceActor, partId),
      ),
   )
}

async function removeThresholdEffectsForPart(sourceActor, partId) {
   const actors = getActorsWithThresholdEffectsForPart(sourceActor, partId)
   for (const targetActor of actors) {
      const effectIds = targetActor.items
         .filter((item) =>
            isThresholdEffectForSourcePart(item, sourceActor, partId),
         )
         .map((item) => item.id)
      if (!effectIds.length) continue
      await targetActor.deleteEmbeddedDocuments("Item", effectIds, {
         rntForceDelete: true,
      })
   }
}

function thresholdEffectsForPart(sourceActor, partId) {
   return getActorsWithThresholdEffectsForPart(sourceActor, partId).flatMap(
      (targetActor) =>
         targetActor.items.filter((item) =>
            isThresholdEffectForSourcePart(item, sourceActor, partId),
         ),
   )
}

async function createThresholdEffectsForTargets(
   sourceActor,
   part,
   activeThresholds,
   activeIndex,
) {
   const targetIds = effectTargetIdsForThresholds(activeThresholds)
   for (const targetId of targetIds) {
      const targetInfo = getRntThresholdTargetData(sourceActor, [targetId])[0]
      const parentEffectsData = createParentEffectsData(
         sourceActor,
         part,
         activeThresholds,
         {
            targetId,
            targetLabel: targetInfo?.label || "",
         },
      )
      if (!parentEffectsData.length) continue

      parentEffectsData.forEach((effect) => {
         effect.flags[MODULE_ID].activeThresholdIndex = activeIndex
      })

      for (const targetActor of resolveRntThresholdTargetActors(sourceActor, {
         targets: [targetId],
      })) {
         await targetActor.createEmbeddedDocuments(
            "Item",
            foundry.utils.deepClone(parentEffectsData),
         )
      }
   }
}

async function rollThresholdDamages(sourceActor, part, threshold) {
   if (!threshold?.damages?.length) return

   const groups = new Map()

   for (const damage of threshold.damages) {
      if (!damage.diceNum && damage.diceNum !== 0) continue
      const targets = normalizeRntThresholdTargets(damage.targets).sort()
      const key = targets.join("|")
      if (!groups.has(key)) groups.set(key, { targets, damages: [] })
      groups.get(key).damages.push(damage)
   }

   for (const group of groups.values()) {
      const formula = RntThresholdDamageCardManager.damageFormula(group.damages)
      if (!formula || formula === "0") continue

      const targetActors = []
      const seen = new Set()
      for (const targetId of group.targets) {
         for (const targetActor of resolveRntThresholdTargetActors(sourceActor, {
            targets: [targetId],
         })) {
            const key = targetActor?.uuid || targetActor?.id
            if (!key || seen.has(key)) continue
            seen.add(key)
            targetActors.push(targetActor)
         }
      }

      await RntThresholdDamageCardManager.postThresholdDamageCard({
         formula,
         targets: targetActors,
         sourceActor,
         part,
      })
   }
}

export async function processThresholdState(actor, part, parts) {
   if (!part.thresholds || part.thresholds.length === 0) {
      await removeThresholdEffectsForPart(actor, part.id)
      delete part.activeThresholdIndex
      await actor.setFlag(MODULE_ID, "parts", parts)
      await syncRntDisabledModules(actor, parts)
      return
   }

   const { activeThresholds, activeIndex } = activeThresholdData(part, parts)
   const existingParents = thresholdEffectsForPart(actor, part.id)
   const storedActiveIndex = Number(part.activeThresholdIndex)
   const existingActiveIndex = Number(
      existingParents[0]?.getFlag(MODULE_ID, "activeThresholdIndex"),
   )
   const currentActiveIndex = Number.isInteger(storedActiveIndex)
      ? storedActiveIndex
      : Number.isInteger(existingActiveIndex)
        ? existingActiveIndex
        : -1
   const hasExistingThresholdEffects = existingParents.length > 0
   const isFullHeal = part.hp.value === part.hp.max

   const { shouldRemoveParent, shouldApplyNewParent } =
      thresholdTransitionState({
         activeIndex,
         activeThresholds,
         currentActiveIndex,
         hasExistingThresholdEffects,
         isFullHeal,
         part,
      })

   if (shouldRemoveParent) {
      await removeThresholdEffectsForPart(actor, part.id)
   }

   if (shouldApplyNewParent && activeThresholds.length > 0) {
      await applyActiveThreshold(actor, part, activeThresholds, activeIndex)
   }

   part.activeThresholdIndex = activeIndex
   await actor.setFlag(MODULE_ID, "parts", parts)
   await syncRntDisabledModules(actor, parts)
}

function activeThresholdData(part, parts) {
   const activeThresholds = []
   let activeIndex = -1
   const ascendingThresholds = part.thresholds
      .map((threshold, index) => ({ ...threshold, originalIndex: index }))
      .sort((a, b) => a.hpValue - b.hpValue)

   for (const threshold of ascendingThresholds) {
      let conditionMet = part.hp.value <= threshold.hpValue
      if (
         conditionMet &&
         threshold.linkedParts &&
         threshold.linkedParts.length > 0
      ) {
         for (const linkedPartId of threshold.linkedParts) {
            const linkedPart = parts.find((candidate) => candidate.id === linkedPartId)
            if (!linkedPart || linkedPart.hp.value > threshold.hpValue) {
               conditionMet = false
               break
            }
         }
      }
      if (conditionMet) {
         activeThresholds.push(threshold)
         if (activeIndex === -1) activeIndex = threshold.originalIndex
      }
   }

   return { activeThresholds, activeIndex }
}

function thresholdTransitionState({
   activeIndex,
   activeThresholds,
   currentActiveIndex,
   hasExistingThresholdEffects,
   isFullHeal,
   part,
}) {
   let shouldRemoveParent = false
   let shouldApplyNewParent = false

   if (
      activeIndex === -1 &&
      hasExistingThresholdEffects &&
      (!part.removeEffectsOnFullHeal || isFullHeal)
   ) {
      shouldRemoveParent = true
   }

   if (activeIndex !== currentActiveIndex) {
      let currentHpValue = Infinity
      if (currentActiveIndex !== -1 && part.thresholds[currentActiveIndex]) {
         currentHpValue = part.thresholds[currentActiveIndex].hpValue
      }
      const newHpValue =
         activeThresholds.length > 0 ? activeThresholds[0].hpValue : Infinity
      const isGettingBetter = newHpValue > currentHpValue

      if (isGettingBetter) {
         if (part.removeEffectsOnFullHeal) {
            if (isFullHeal) {
               shouldRemoveParent = true
               if (activeThresholds.length > 0) shouldApplyNewParent = true
            }
         } else {
            shouldRemoveParent = true
            if (activeThresholds.length > 0) shouldApplyNewParent = true
         }
      } else {
         shouldRemoveParent = true
         if (activeThresholds.length > 0) shouldApplyNewParent = true
      }
   }

   return { shouldRemoveParent, shouldApplyNewParent }
}

async function applyActiveThreshold(actor, part, activeThresholds, activeIndex) {
   await createThresholdEffectsForTargets(
      actor,
      part,
      activeThresholds,
      activeIndex,
   )

   const mainActiveThreshold = activeThresholds[0]
   await rollThresholdDamages(actor, part, mainActiveThreshold)
   await executeThresholdMacros(actor, part, mainActiveThreshold)
   await executeThresholdScripts(actor, part, mainActiveThreshold)
}

async function executeThresholdMacros(actor, part, threshold) {
   if (!threshold.macros || threshold.macros.length === 0) return
   for (const macroData of threshold.macros) {
      if (!macroData.uuid || macroData.invalid) continue
      const macro = await fromUuid(macroData.uuid)
      if (macro && macro.documentName === "Macro") {
         macro.execute({ actor, part, threshold })
      }
   }
}

async function executeThresholdScripts(actor, part, threshold) {
   if (!threshold.scripts || threshold.scripts.length === 0) return
   for (const script of threshold.scripts) {
      if (!script.code || script.code.trim() === "") continue
      try {
         const AsyncFunction = Object.getPrototypeOf(async function () {})
            .constructor
         const fn = new AsyncFunction("actor", "part", "threshold", script.code)
         await fn(actor, part, threshold)
      } catch (_err) {
         ui.notifications.error(
            game.i18n.localize(`${MODULE_ID}.thresholdScriptFailed`),
         )
      }
   }
}
