import { MODULE_ID } from "../constants.mjs"
import {
   RNT_THRESHOLD_TARGET_POSITION_PREFIX,
   RNT_THRESHOLD_TARGET_VEHICLE,
} from "./constants.mjs"
import { getSiegeApi, isSiegeVehicleActor } from "./siege-core.mjs"
import { normalizeIdList } from "./utils.mjs"

export function makeRntPositionTargetId(positionTitle) {
   const title = String(positionTitle || "").trim()
   return title ? `${RNT_THRESHOLD_TARGET_POSITION_PREFIX}${title}` : ""
}

export function parseRntPositionTargetId(targetId) {
   const id = String(targetId || "").trim()
   return id.startsWith(RNT_THRESHOLD_TARGET_POSITION_PREFIX)
      ? id.slice(RNT_THRESHOLD_TARGET_POSITION_PREFIX.length).trim()
      : ""
}

export function normalizeRntThresholdTargets(targets) {
   const values =
      targets instanceof Set
         ? Array.from(targets)
         : Array.isArray(targets)
           ? targets
           : targets
             ? String(targets).split(",")
             : []
   const clean = normalizeIdList(values)
   return clean.length ? clean : [RNT_THRESHOLD_TARGET_VEHICLE]
}

export function getRntThresholdTargetOptions(actor) {
   const options = [
      {
         id: RNT_THRESHOLD_TARGET_VEHICLE,
         type: "vehicle",
         label: actor?.name || game.i18n.localize(`${MODULE_ID}.vehicle`),
      },
   ]

   if (!isSiegeVehicleActor(actor)) return options

   const siege = getSiegeApi()
   let positions = []
   try {
      const data = siege?.getCrewPositions?.(actor)
      positions = Array.isArray(data) ? data : []
   } catch (_err) {
   }

   for (const position of positions) {
      const title = String(position?.title || position?.name || "").trim()
      const id = makeRntPositionTargetId(title)
      if (!id || options.some((option) => option.id === id)) continue
      options.push({
         id,
         type: "position",
         label: title,
         position: title,
         icon: position.icon || "",
      })
   }

   return options
}

export function getRntThresholdTargetData(actor, targets) {
   const targetIds = normalizeRntThresholdTargets(targets)
   const options = getRntThresholdTargetOptions(actor)
   return targetIds.map((id) => {
      const option = options.find((candidate) => candidate.id === id)
      if (option) return option
      const position = parseRntPositionTargetId(id)
      return {
         id,
         type: position ? "position" : "unknown",
         label:
            position ||
            game.i18n.localize(`${MODULE_ID}.unknownTarget`) ||
            id,
         position,
      }
   })
}

export function resolveRntThresholdTargetActors(actor, entry = {}) {
   const targets = normalizeRntThresholdTargets(entry.targets)
   const actors = []
   const seen = new Set()

   const addActor = (targetActor) => {
      if (!targetActor) return
      const key = targetActor.uuid || targetActor.id
      if (!key || seen.has(key)) return
      seen.add(key)
      actors.push(targetActor)
   }

   for (const targetId of targets) {
      if (targetId === RNT_THRESHOLD_TARGET_VEHICLE) {
         addActor(actor)
         continue
      }

      const position = parseRntPositionTargetId(targetId)
      if (!position || !isSiegeVehicleActor(actor)) continue

      const siege = getSiegeApi()
      try {
         const crewActors = siege?.getCrewActorsForPosition?.(actor, position)
         if (Array.isArray(crewActors)) {
            for (const crewActor of crewActors) addActor(crewActor)
         }
      } catch (_err) {
      }
   }

   return actors
}
