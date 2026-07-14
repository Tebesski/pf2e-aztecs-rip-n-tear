import { MODULE_ID } from "../constants.mjs"
import {
   getDefaultBodyPartIcon,
   normalizeRntThresholdTargets,
   RNT_THRESHOLD_TARGET_VEHICLE,
} from "../actor-support.mjs"
import { unorderedListHtml } from "../html-format.mjs"

function thresholdEntryTargetsInclude(entry, targetId) {
   return normalizeRntThresholdTargets(entry?.targets).includes(targetId)
}

export function effectTargetIdsForThresholds(thresholds) {
   const ids = new Set()
   for (const threshold of thresholds) {
      for (const collection of [
         threshold.conditions || [],
         threshold.effects || [],
         threshold.ruleElements || [],
      ]) {
         for (const entry of collection) {
            for (const target of normalizeRntThresholdTargets(entry?.targets)) {
               ids.add(target)
            }
         }
      }
   }
   return Array.from(ids)
}

export function createParentEffectsData(
   actor,
   part,
   thresholds,
   { targetId = RNT_THRESHOLD_TARGET_VEHICLE, targetLabel = "" } = {},
) {
   const groups = new Map()

   const addRule = (item, rule, description) => {
      const key = `${item.durationValue || ""}|${item.durationUnit || ""}`
      if (!groups.has(key)) {
         groups.set(key, {
            durationValue: item.durationValue,
            durationUnit: item.durationUnit,
            rules: [],
            descriptions: [],
         })
      }
      groups.get(key).rules.push(rule)
      groups.get(key).descriptions.push(description)
   }

   for (const threshold of thresholds) {
      if (threshold.conditions) {
         for (const cond of threshold.conditions) {
            if (!thresholdEntryTargetsInclude(cond, targetId)) continue
            const conditionBase = game.pf2e.ConditionManager.getCondition(
               cond.slug,
            )
            if (!conditionBase) continue
            const rule = {
               key: "GrantItem",
               uuid: conditionBase.sourceId || conditionBase.uuid,
               onDeleteActions: { grantee: "restrict" },
            }
            if (cond.hasValue || cond.value > 1) {
               rule.alterations = [
                  {
                     property: "badge-value",
                     mode: "override",
                     value: cond.value,
                  },
               ]
            }
            addRule(
               cond,
               rule,
               `@UUID[${conditionBase.sourceId || conditionBase.uuid}]`,
            )
         }
      }

      if (threshold.effects) {
         for (const ef of threshold.effects) {
            if (!thresholdEntryTargetsInclude(ef, targetId)) continue
            if (ef.uuid && !ef.invalid) {
               addRule(
                  ef,
                  {
                     key: "GrantItem",
                     uuid: ef.uuid,
                     onDeleteActions: { grantee: "restrict" },
                  },
                  `@UUID[${ef.uuid}]`,
               )
            }
         }
      }

      if (threshold.ruleElements) {
         for (const re of threshold.ruleElements) {
            if (!thresholdEntryTargetsInclude(re, targetId)) continue
            if (!re.invalid && re.json && re.json.trim() !== "") {
               try {
                  const desc =
                     re.customDescription && re.customDescription.trim() !== ""
                        ? re.customDescription
                        : game.i18n.localize(`${MODULE_ID}.ruleElement`)
                  addRule(re, JSON.parse(re.json), desc)
               } catch (e) {}
            }
         }
      }
   }

   const effectsData = []
   let index = 1

   for (const group of groups.values()) {
      const durationData =
         group.durationValue &&
         group.durationUnit &&
         group.durationUnit !== "unlimited"
            ? {
                 value: group.durationValue,
                 unit: group.durationUnit,
                 expiry: "turn-end",
              }
            : { value: -1, unit: "unlimited" }

      const descValue = unorderedListHtml(group.descriptions)

      const targetSuffix =
         targetId !== RNT_THRESHOLD_TARGET_VEHICLE && targetLabel
            ? ` (${targetLabel})`
            : ""

      effectsData.push({
         name: game.i18n.format(`${MODULE_ID}.thresholdEffectName`, {
            partName: part.name,
            targetSuffix,
            index,
         }),
         type: "effect",
         img: part.img || getDefaultBodyPartIcon(actor),
         system: {
            description: { value: descValue },
            duration: durationData,
            rules: group.rules,
         },
         flags: {
            [MODULE_ID]: {
               isBodyPartEffect: true,
               bodyPartName: part.name,
               partId: part.id,
               thresholdSourceActorId: actor.id,
               thresholdSourceActorUuid: actor.uuid,
               thresholdTargetId: targetId,
               thresholdTargetLabel: targetLabel,
            },
         },
      })
      index++
   }

   return effectsData
}
