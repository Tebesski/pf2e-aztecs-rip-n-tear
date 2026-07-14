import { getActorItemsByType } from "./core.mjs"
import { SIEGE_MODULE_ID } from "./constants.mjs"
import {
   getInstalledSiegeModuleData,
   isSiegeVehicleActor,
} from "./siege-core.mjs"
import { normalizeIdList } from "./utils.mjs"

export function isSiegeComponentAction(item) {
   if (item?.type !== "action") return false
   return !!item.getFlag?.(SIEGE_MODULE_ID, "siegeAction")?.isComponent
}

export function getSiegeComponentActionData(actor) {
   if (!isSiegeVehicleActor(actor)) return []
   return getActorItemsByType(actor, "action")
      .filter(isSiegeComponentAction)
      .map((item) => ({
         id: item.id,
         itemId: item.id,
         name: item.name,
         img: item.img || "icons/svg/cogs.svg",
         slotKind: "component",
         moduleType: "component",
         active: true,
         disabled: false,
         isComponentAction: true,
      }))
}

export function getRntLinkableModuleData(actor) {
   if (!isSiegeVehicleActor(actor)) return []
   const byId = new Map()
   for (const moduleData of getInstalledSiegeModuleData(actor)) {
      if (!moduleData?.id) continue
      byId.set(moduleData.id, {
         ...moduleData,
         isComponentAction: !!moduleData.isComponentAction,
      })
   }
   for (const actionData of getSiegeComponentActionData(actor)) {
      if (!actionData?.id || byId.has(actionData.id)) continue
      byId.set(actionData.id, actionData)
   }
   return Array.from(byId.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
   )
}

export function normalizeRntSiegeComponentLinks(actor, parts = []) {
   if (!isSiegeVehicleActor(actor) || !Array.isArray(parts)) return false
   let changed = false

   for (const part of parts) {
      const linkedItems = normalizeIdList(part.linkedItems)
      const linkedModules = normalizeIdList(part.linkedModules)
      const getItem = (id) =>
         actor.items?.get?.(id) || actor.items?.find?.((item) => item.id === id)
      const componentLinkedItems = linkedItems.filter((id) =>
         isSiegeComponentAction(getItem(id)),
      )
      if (!componentLinkedItems.length) {
         if (
            JSON.stringify(part.linkedItems || []) !==
            JSON.stringify(linkedItems)
         ) {
            part.linkedItems = linkedItems
            changed = true
         }
         if (
            JSON.stringify(part.linkedModules || []) !==
            JSON.stringify(linkedModules)
         ) {
            part.linkedModules = linkedModules
            changed = true
         }
         continue
      }

      part.linkedItems = linkedItems.filter(
         (id) => !componentLinkedItems.includes(id),
      )
      part.linkedModules = Array.from(
         new Set([...linkedModules, ...componentLinkedItems]),
      )
      for (const threshold of part.thresholds || []) {
         if (threshold.disableAbilities && !threshold.disableModules) {
            threshold.disableModules = true
         }
      }
      changed = true
   }

   return changed
}
