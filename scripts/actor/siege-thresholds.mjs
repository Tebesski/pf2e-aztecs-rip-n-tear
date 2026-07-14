import { MODULE_ID } from "../constants.mjs"
import {
   RNT_VEHICLE_THRESHOLD_MODIFIERS_FLAG,
   SIEGE_LOAD_SIZE_MULTIPLIER,
   SIEGE_MODULE_ID,
   SIEGE_SIZE_BULK,
} from "./constants.mjs"
import { isSiegeVehicleActor } from "./siege-core.mjs"
import {
   hasOwnKeys,
   normalizeIdList,
   numberOrZero,
   roundTenth,
} from "./utils.mjs"

function isExplicitSiegeLoadCapacity(value) {
   if (value === "" || value === null || value === undefined) return false
   const num = Number(value)
   return Number.isFinite(num) && num > 0
}

function getSiegeSizeBulk(actor) {
   const size = actor?.system?.traits?.size?.value || "med"
   return SIEGE_SIZE_BULK[size] ?? SIEGE_SIZE_BULK.med
}

function getSiegeDefaultLoadCapacity(actor) {
   const flagBulk = Number(actor?.getFlag?.(SIEGE_MODULE_ID, "bulk")) || 0
   const ownBulk = flagBulk > 0 ? flagBulk : getSiegeSizeBulk(actor)
   const size = actor?.system?.traits?.size?.value || "med"
   const multiplier = SIEGE_LOAD_SIZE_MULTIPLIER[size] || 1
   return roundTenth(ownBulk * multiplier)
}

function getCurrentSiegeLoadCapacityBase(actor) {
   const raw = actor?.getFlag?.(SIEGE_MODULE_ID, "loadCapacity")
   if (isExplicitSiegeLoadCapacity(raw)) return roundTenth(raw)
   return getSiegeDefaultLoadCapacity(actor)
}

export function isRntThresholdActive(part, threshold, parts) {
   if (!part || !threshold) return false
   const hpValue = Number(part.hp?.value ?? 0)
   const thresholdHp = Number(threshold.hpValue ?? 0)
   if (hpValue > thresholdHp) return false

   const linkedParts = normalizeIdList(threshold.linkedParts)
   for (const linkedPartId of linkedParts) {
      const linkedPart = parts.find((p) => p.id === linkedPartId)
      if (!linkedPart || Number(linkedPart.hp?.value ?? 0) > thresholdHp) {
         return false
      }
   }
   return true
}

export function collectRntVehicleThresholdModifiers(actor, parts = null) {
   const modifiers = { speed: 0, loadCapacity: 0 }
   if (!isSiegeVehicleActor(actor)) return modifiers

   const allParts =
      parts ||
      foundry.utils.deepClone(actor.getFlag(MODULE_ID, "parts") || [])

   for (const part of allParts) {
      for (const threshold of part.thresholds || []) {
         if (!isRntThresholdActive(part, threshold, allParts)) continue
         if (threshold.modifyVehicleSpeed) {
            modifiers.speed += numberOrZero(threshold.vehicleSpeedModifier)
         }
         if (threshold.modifyVehicleLoadCapacity) {
            modifiers.loadCapacity += numberOrZero(
               threshold.vehicleLoadCapacityModifier,
            )
         }
      }
   }

   modifiers.speed = numberOrZero(modifiers.speed)
   modifiers.loadCapacity = roundTenth(modifiers.loadCapacity)
   return modifiers
}

export async function syncRntVehicleThresholdModifiers(actor, parts = null) {
   if (!game.user?.isGM || !isSiegeVehicleActor(actor)) return

   try {
      const modifiers = collectRntVehicleThresholdModifiers(actor, parts)
      const currentState =
         actor.getFlag(MODULE_ID, RNT_VEHICLE_THRESHOLD_MODIFIERS_FLAG) || {}
      const nextState = {}
      const update = {}
      let shouldUnsetRntState = false
      let shouldUnsetLoadCapacity = false

      const previousSpeedDelta = numberOrZero(currentState.speed?.delta)
      const nextSpeedDelta = numberOrZero(modifiers.speed)
      if (nextSpeedDelta !== 0 || currentState.speed) {
         const loadPreviousSpeed = actor.getFlag(
            SIEGE_MODULE_ID,
            "loadPreviousSpeed",
         )
         const speedPath =
            loadPreviousSpeed !== undefined
               ? `flags.${SIEGE_MODULE_ID}.loadPreviousSpeed`
               : "system.details.speed"
         const currentSpeed = numberOrZero(
            loadPreviousSpeed !== undefined
               ? loadPreviousSpeed
               : actor.system?.details?.speed,
         )
         const storedBase = Number(currentState.speed?.base)
         const base = Number.isFinite(storedBase)
            ? storedBase
            : currentSpeed - previousSpeedDelta
         const targetSpeed = Math.max(0, base + nextSpeedDelta)

         const currentSpeedAtPath =
            loadPreviousSpeed !== undefined
               ? numberOrZero(loadPreviousSpeed)
               : numberOrZero(actor.system?.details?.speed)
         if (currentSpeedAtPath !== targetSpeed) {
            update[speedPath] = targetSpeed
         }

         if (nextSpeedDelta !== 0) {
            nextState.speed = { base, delta: nextSpeedDelta }
         }
      }

      const previousLoadDelta = numberOrZero(currentState.loadCapacity?.delta)
      const nextLoadDelta = roundTenth(modifiers.loadCapacity)
      if (nextLoadDelta !== 0 || currentState.loadCapacity) {
         const rawLoad = actor.getFlag(SIEGE_MODULE_ID, "loadCapacity")
         const currentHadExplicit = isExplicitSiegeLoadCapacity(rawLoad)
         const storedBase = Number(currentState.loadCapacity?.base)
         const hadExplicit =
            currentState.loadCapacity?.hadExplicit ?? currentHadExplicit
         const base = Number.isFinite(storedBase)
            ? storedBase
            : getCurrentSiegeLoadCapacityBase(actor) - previousLoadDelta
         const targetLoadCapacity = Math.max(0, roundTenth(base + nextLoadDelta))

         if (nextLoadDelta !== 0) {
            const currentLoad = currentHadExplicit ? roundTenth(rawLoad) : null
            if (currentLoad !== targetLoadCapacity) {
               update[`flags.${SIEGE_MODULE_ID}.loadCapacity`] =
                  targetLoadCapacity
            }
            nextState.loadCapacity = {
               base,
               hadExplicit: !!hadExplicit,
               delta: nextLoadDelta,
            }
         } else if (currentState.loadCapacity) {
            if (hadExplicit) {
               if (
                  !currentHadExplicit ||
                  roundTenth(rawLoad) !== roundTenth(base)
               ) {
                  update[`flags.${SIEGE_MODULE_ID}.loadCapacity`] =
                     roundTenth(base)
               }
            } else {
               shouldUnsetLoadCapacity = true
            }
         }
      }

      if (hasOwnKeys(nextState)) {
         if (JSON.stringify(currentState) !== JSON.stringify(nextState)) {
            update[`flags.${MODULE_ID}.${RNT_VEHICLE_THRESHOLD_MODIFIERS_FLAG}`] =
               nextState
         }
      } else if (hasOwnKeys(currentState)) {
         shouldUnsetRntState = true
      }

      if (Object.keys(update).length > 0) {
         await actor.update(update, { rntVehicleThresholdSync: true })
      }
      if (shouldUnsetLoadCapacity) {
         await actor.unsetFlag(SIEGE_MODULE_ID, "loadCapacity")
      }
      if (shouldUnsetRntState) {
         await actor.unsetFlag(
            MODULE_ID,
            RNT_VEHICLE_THRESHOLD_MODIFIERS_FLAG,
         )
      }
   } catch (_err) {
   }
}
