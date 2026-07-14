import { MODULE_ID } from "./constants.mjs"

export class RntSocketManager {
   static initHooks() {
      const registerSocket = () => {
         if (globalThis.ripAndTearSocket) return
         if (!globalThis.socketlib) return

         globalThis.ripAndTearSocket = socketlib.registerModule(MODULE_ID)

         globalThis.ripAndTearSocket.register(
            "applyThresholdDamageCardDamage",
            async (payload = {}) => {
               const { RntThresholdDamageCardManager } = await import(
                  "./threshold-damage-card.mjs"
               )
               return RntThresholdDamageCardManager.gmApplyCardDamage(payload)
            },
         )

         globalThis.ripAndTearSocket.register(
            "persistThresholdDamageCard",
            async (payload = {}) => {
               const { RntThresholdDamageCardManager } = await import(
                  "./threshold-damage-card.mjs"
               )
               return RntThresholdDamageCardManager.gmPersistCard(payload)
            },
         )

         globalThis.ripAndTearSocket.register(
            "applySiegeRepairResult",
            async (payload = {}) => {
               const { gmApplySiegeRepairResult } = await import(
                  "./repair-integration.mjs"
               )
               return gmApplySiegeRepairResult(payload)
            },
         )
      }

      Hooks.once("socketlib.ready", registerSocket)
      Hooks.once("ready", () => {
         if (game.modules.get("socketlib")?.active) registerSocket()
      })
   }
}
