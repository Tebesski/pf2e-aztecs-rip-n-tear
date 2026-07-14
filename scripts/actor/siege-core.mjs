import {
   RNT_DEFAULT_BODY_PART_ICON,
   RNT_SIEGE_THEME_CLASS,
   RNT_VEHICLE_BODY_PART_ICON,
   SIEGE_MODULE_ID,
} from "./constants.mjs"

export function getSiegeApi() {
   return (
      globalThis.game?.modules?.get?.(SIEGE_MODULE_ID)?.api ??
      globalThis.PF2eAztecsSiege ??
      null
   )
}

export function isSiegeVehicleActor(actor) {
   if (actor?.type !== "vehicle") return false
   const siege = getSiegeApi()
   try {
      return !!siege?.isTrackedVehicle?.(actor)
   } catch (_err) {
      return false
   }
}

export function isRntSupportedActor(actor) {
   if (actor?.type === "npc") return true
   return isSiegeVehicleActor(actor)
}

export function getDefaultBodyPartIcon(actor) {
   return isSiegeVehicleActor(actor)
      ? RNT_VEHICLE_BODY_PART_ICON
      : RNT_DEFAULT_BODY_PART_ICON
}

export function withRntActorTheme(options = {}) {
   if (!isSiegeVehicleActor(options.actor)) return options
   const classes = new Set(["pf2e", "rnt-app-v2", ...(options.classes || [])])
   classes.add(RNT_SIEGE_THEME_CLASS)
   return { ...options, classes: Array.from(classes) }
}

export function withRntDialogTheme(options = {}, actor) {
   if (!isSiegeVehicleActor(actor)) return options
   const classes = new Set(["pf2e", "rnt-app-v2", ...(options.classes || [])])
   classes.add(RNT_SIEGE_THEME_CLASS)
   return { ...options, classes: Array.from(classes) }
}

export function applyRntThemeClass(element, actor) {
   if (!isSiegeVehicleActor(actor)) return
   const root = element instanceof HTMLElement ? element : element?.[0]
   root?.classList?.add(RNT_SIEGE_THEME_CLASS)
}

export function getInstalledSiegeModuleData(actor) {
   if (!isSiegeVehicleActor(actor)) return []
   const siege = getSiegeApi()
   try {
      const data = siege?.getInstalledModuleData?.(actor)
      return Array.isArray(data) ? data : []
   } catch (_err) {
      return []
   }
}
