import { MODULE_ID } from "../constants.mjs"

export function setupCombatTurnHook() {
   Hooks.on("updateCombat", async (combat, changed, options, userId) => {
      if (!game.user.isGM) return
      if (!("turn" in changed) && !("round" in changed)) return

      const previousId = combat.previous?.combatantId
      const m = await import("../mechanics.mjs")

      for (const c of combat.combatants) {
         if (!c.actor) continue

         const isRegenDisabled = c.actor.items.some((i) =>
            i.getFlag(MODULE_ID, "isRegenDisabled"),
         )
         if (isRegenDisabled) continue

         const parts = c.actor.getFlag(MODULE_ID, "parts") || []
         const isTheirTurnEnd = c.id === previousId

         for (let p of parts) {
            if (
               p.regrowth?.enabled &&
               p.hp.value > 0 &&
               p.hp.value < p.hp.max
            ) {
               if (p.regrowth.anyTurn || isTheirTurnEnd) {
                  const healAmount = p.regrowth.full
                     ? p.hp.max
                     : p.regrowth.amount || 0
                  if (healAmount > 0) {
                     await m.applyBodyPartHealing(c.actor, p.id, healAmount)
                  }
               }
            }
         }

         if (isTheirTurnEnd) {
            const hotEffects = c.actor.items.filter((i) =>
               i.getFlag(MODULE_ID, "isHoT"),
            )
            for (const effect of hotEffects) {
               const hotData = effect.getFlag(MODULE_ID, "hotData")
               if (hotData && hotData.partId && hotData.amount) {
                  await m.applyBodyPartHealing(
                     c.actor,
                     hotData.partId,
                     hotData.amount,
                  )
               }
            }
         }
      }

      if (previousId) {
         const previousCombatant = combat.combatants.get(previousId)
         if (previousCombatant && previousCombatant.actor) {
            const persistentEffects = previousCombatant.actor.items.filter(
               (i) => i.getFlag(MODULE_ID, "isPersistent"),
            )
            for (const effect of persistentEffects) {
               import("../apps/persistent-dialog.mjs").then((module) => {
                  new module.PersistentDamageApp({
                     actor: previousCombatant.actor,
                     token: previousCombatant.token,
                     effect,
                  }).render(true)
               })
            }
         }
      }
   })
}

