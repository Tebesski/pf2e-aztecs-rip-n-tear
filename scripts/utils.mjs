import { MODULE_ID } from "./constants.mjs"

const HP_TEXT_KEYS = [
   { max: 0, key: "textDestroyed", color: "darkred" },
   { max: 25, key: "textMutilated", color: "red" },
   { max: 50, key: "textSevere", color: "darkorange" },
   { max: 99, key: "textBarely", color: "goldenrod" },
   { max: 100, key: "textIntact", color: "green" },
]

function getHpTier(part) {
   const pct = part.hp.max > 0 ? (part.hp.value / part.hp.max) * 100 : 0
   return HP_TEXT_KEYS.find((tier) => pct <= tier.max) || HP_TEXT_KEYS[4]
}

export function getBodyPartHpText(part) {
   if (!game.settings.get(MODULE_ID, "useHpText"))
      return `${part.hp.value} / ${part.hp.max}`
   return game.settings.get(MODULE_ID, getHpTier(part).key)
}

export function getBodyPartHpColor(part) {
   const useText = game.settings.get("pf2e-aztecs-rip-n-tear", "useHpText")
   const usePct = game.settings.get("pf2e-aztecs-rip-n-tear", "usePercentageHp")
   if (!useText && !usePct) return "inherit"
   return getHpTier(part).color
}

export function prepareBodyPartDisplay(part, actor, isCalledShot = false) {
   const usePercentage = game.settings.get(
      "pf2e-aztecs-rip-n-tear",
      "usePercentageHp",
   )
   const useText = game.settings.get("pf2e-aztecs-rip-n-tear", "useHpText")
   const showAcDiff = game.settings.get(
      "pf2e-aztecs-rip-n-tear",
      "showAcDifference",
   )

   const baseAc =
      actor?.system?.attributes?.ac?.value || actor?.attributes?.ac?.value || 0

   let adj = 0
   if (
      part.acAdjustment !== undefined &&
      part.acAdjustment !== null &&
      part.acAdjustment !== ""
   ) {
      adj = Number(part.acAdjustment)
   } else if (part.ac !== undefined && part.ac !== null) {
      adj = Number(part.ac) - baseAc
   }

   let acDisplay = baseAc + adj
   if (showAcDiff) {
      acDisplay = adj >= 0 ? `+${adj}` : `${adj}`
   }

   let hpDisplay = `${part.hp.value} / ${part.hp.max}`
   if (usePercentage) {
      const pct =
         part.hp.max > 0 ? Math.round((part.hp.value / part.hp.max) * 100) : 0
      hpDisplay = `HP: ${pct}%`
   } else if (useText && isCalledShot) {
      hpDisplay = getBodyPartHpText(part)
   }

   return { acDisplay, hpDisplay }
}
