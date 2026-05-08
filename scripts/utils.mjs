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
   if (!game.settings.get(MODULE_ID, "useHpText")) return "inherit"
   return getHpTier(part).color
}
