import { MODULE_ID } from "../constants.mjs"
import {
   RNT_DISABLED_COMPONENT_ACTIONS_FLAG,
   RNT_SIEGE_DISABLED_SOURCE,
   SIEGE_DAMAGE_DISABLED_REASON,
   SIEGE_MODULE_ID,
} from "./constants.mjs"
import {
   getInstalledSiegeModuleData,
   getSiegeApi,
   isSiegeVehicleActor,
} from "./siege-core.mjs"
import {
   getSiegeComponentActionData,
   isSiegeComponentAction,
   normalizeRntSiegeComponentLinks,
} from "./siege-components.mjs"
import {
   isRntThresholdActive,
   syncRntVehicleThresholdModifiers,
} from "./siege-thresholds.mjs"
import { normalizeIdList } from "./utils.mjs"

export function collectRntDisabledModuleIds(actor, parts = null) {
   if (!isSiegeVehicleActor(actor)) return []

   const allParts =
      parts ||
      foundry.utils.deepClone(actor.getFlag(MODULE_ID, "parts") || [])
   normalizeRntSiegeComponentLinks(actor, allParts)
   const installed = new Set(
      getInstalledSiegeModuleData(actor).map((moduleData) => moduleData.id),
   )
   const disabledIds = new Set()

   for (const part of allParts) {
      const linkedModules = normalizeIdList(part.linkedModules)
      if (!linkedModules.length) continue

      const activeDisable = (part.thresholds || []).some(
         (threshold) =>
            threshold.disableModules &&
            isRntThresholdActive(part, threshold, allParts),
      )
      if (!activeDisable) continue

      for (const moduleId of linkedModules) {
         if (installed.has(moduleId)) disabledIds.add(moduleId)
      }
   }

   return Array.from(disabledIds).sort()
}

function hasStaleSiegeGeneratedActionDisabledState(actor, disabledModuleIds = []) {
   const disabled = new Set(normalizeIdList(disabledModuleIds))

   for (const item of actor?.items || []) {
      if (item?.type !== "action") continue

      const generated = item.getFlag?.(SIEGE_MODULE_ID, "moduleGenerated")
      if (generated?.kind !== "action") continue

      const moduleItemId = String(generated.moduleItemId || "").trim()
      if (!moduleItemId) continue

      const flag = item.getFlag?.(SIEGE_MODULE_ID, "siegeAction") || {}
      const disabledByVehicleDamage =
         flag.disabledByModule === true ||
         flag.disabledReason === SIEGE_DAMAGE_DISABLED_REASON

      if (disabled.has(moduleItemId) !== disabledByVehicleDamage) return true
   }

   return false
}

export function collectRntDisabledComponentActionIds(actor, parts = null) {
   if (!isSiegeVehicleActor(actor)) return []

   const allParts =
      parts ||
      foundry.utils.deepClone(actor.getFlag(MODULE_ID, "parts") || [])
   normalizeRntSiegeComponentLinks(actor, allParts)
   const componentActionIds = new Set(
      getSiegeComponentActionData(actor).map((actionData) => actionData.id),
   )
   const disabledIds = new Set()

   for (const part of allParts) {
      const linkedModules = normalizeIdList(part.linkedModules)
      if (!linkedModules.length) continue

      const activeDisable = (part.thresholds || []).some(
         (threshold) =>
            threshold.disableModules &&
            isRntThresholdActive(part, threshold, allParts),
      )
      if (!activeDisable) continue

      for (const moduleId of linkedModules) {
         if (componentActionIds.has(moduleId)) disabledIds.add(moduleId)
      }
   }

   return Array.from(disabledIds).sort()
}

export function getStoredRntDisabledComponentActionIds(actor, source = null) {
   if (!actor) return []
   const siege = getSiegeApi()
   if (siege?.getDisabledComponentActionIds) {
      try {
         return normalizeIdList(
            siege.getDisabledComponentActionIds(
               actor,
               source || RNT_SIEGE_DISABLED_SOURCE,
            ) || [],
         ).sort()
      } catch (_err) {
      }
   }
   return normalizeIdList(
      actor.getFlag(MODULE_ID, RNT_DISABLED_COMPONENT_ACTIONS_FLAG) || [],
   ).sort()
}

export function isRntComponentActionDisabled(actor, item) {
   if (!item?.id || !isSiegeComponentAction(item)) return false
   return getStoredRntDisabledComponentActionIds(actor).includes(item.id)
}

async function syncRntDisabledComponentActions(actor, parts = null) {
   const disabledIds = collectRntDisabledComponentActionIds(actor, parts)
   const siege = getSiegeApi()

   if (
      siege?.setDisabledComponentActionIds &&
      siege?.clearDisabledComponentActionIds
   ) {
      try {
         const currentIds = normalizeIdList(
            siege?.getDisabledComponentActionIds?.(
               actor,
               RNT_SIEGE_DISABLED_SOURCE,
            ) || [],
         ).sort()
         const nextIds = [...disabledIds].sort()
         if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
            if (disabledIds.length) {
               await siege.setDisabledComponentActionIds(actor, disabledIds, {
                  source: RNT_SIEGE_DISABLED_SOURCE,
               })
            } else {
               await siege.clearDisabledComponentActionIds(actor, {
                  source: RNT_SIEGE_DISABLED_SOURCE,
               })
            }
         }
         return
      } catch (_err) {
      }
   }

   try {
      const currentIds = normalizeIdList(
         actor.getFlag(MODULE_ID, RNT_DISABLED_COMPONENT_ACTIONS_FLAG) || [],
      ).sort()
      const nextIds = [...disabledIds].sort()
      if (JSON.stringify(currentIds) === JSON.stringify(nextIds)) return

      if (disabledIds.length) {
         await actor.setFlag(
            MODULE_ID,
            RNT_DISABLED_COMPONENT_ACTIONS_FLAG,
            disabledIds,
         )
      } else {
         await actor.unsetFlag(MODULE_ID, RNT_DISABLED_COMPONENT_ACTIONS_FLAG)
      }
      Hooks.callAll(
         `${MODULE_ID}.disabledComponentActionsChanged`,
         actor,
         disabledIds,
      )
   } catch (_err) {
   }
}

export async function syncRntDisabledModules(actor, parts = null) {
   if (!game.user?.isGM || !isSiegeVehicleActor(actor)) return

   const syncParts =
      parts ||
      foundry.utils.deepClone(actor.getFlag(MODULE_ID, "parts") || [])
   const migratedLinks = normalizeRntSiegeComponentLinks(actor, syncParts)
   if (!parts && migratedLinks) {
      await actor.setFlag(MODULE_ID, "parts", syncParts)
   }

   await syncRntVehicleThresholdModifiers(actor, syncParts)
   await syncRntDisabledComponentActions(actor, syncParts)

   const siege = getSiegeApi()
   if (!siege?.setDisabledModuleIds || !siege?.clearDisabledModuleIds) return

   try {
      const disabledIds = collectRntDisabledModuleIds(actor, syncParts)
      const currentIds = normalizeIdList(
         siege?.getDisabledModuleIds?.(actor, RNT_SIEGE_DISABLED_SOURCE) || [],
      ).sort()
      const nextIds = [...disabledIds].sort()
      if (JSON.stringify(currentIds) === JSON.stringify(nextIds)) {
         if (hasStaleSiegeGeneratedActionDisabledState(actor, nextIds)) {
            if (siege.queueModuleSync) siege.queueModuleSync(actor)
            else if (siege.syncModules) await siege.syncModules(actor)
         }
         return
      }

      if (disabledIds.length) {
         await siege.setDisabledModuleIds(actor, disabledIds, {
            source: RNT_SIEGE_DISABLED_SOURCE,
         })
      } else {
         await siege.clearDisabledModuleIds(actor, {
            source: RNT_SIEGE_DISABLED_SOURCE,
         })
      }
   } catch (_err) {
   }
}
