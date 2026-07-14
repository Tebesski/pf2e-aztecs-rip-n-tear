import { MODULE_ID } from "../constants.mjs"

export const CARD_FLAG = "thresholdDamageCard"
export const TEMPLATE_BASE = `modules/${MODULE_ID}/templates/chat`

export const DAMAGE_COLOR_MAP = {
   fire: "#e85d04",
   cold: "#00b4d8",
   acid: "#70e000",
   electricity: "#ffb703",
   bludgeoning: "#4b5563",
   piercing: "#4b5563",
   slashing: "#4b5563",
   sonic: "#0077b6",
   force: "#7209b7",
   vitality: "#ffb703",
   void: "#3a0ca3",
   mental: "#f72585",
   poison: "#008000",
   bleed: "#d90429",
   spirit: "#e0aaff",
   holy: "#ffea00",
   unholy: "#370617",
   untyped: "#ffffff",
}

export const DAMAGE_ICON_MAP = {
   fire: "fa-fire",
   cold: "fa-snowflake",
   acid: "fa-flask",
   electricity: "fa-bolt",
   bludgeoning: "fa-hammer",
   piercing: "fa-bow-arrow",
   slashing: "fa-sword",
   sonic: "fa-volume-high",
   force: "fa-sparkles",
   vitality: "fa-sun",
   void: "fa-moon",
   mental: "fa-brain",
   poison: "fa-skull-crossbones",
   bleed: "fa-droplet",
   spirit: "fa-ghost",
   holy: "fa-cross",
   unholy: "fa-pentagram",
   untyped: "fa-circle",
}

export const localize = (key) => game.i18n.localize(`${MODULE_ID}.${key}`)

export function capitalizeDamageType(type) {
   return String(type || "untyped")
      .replace(/[-_]+/g, " ")
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function renderThresholdCardTemplate(path, data) {
   const render =
      foundry.applications?.handlebars?.renderTemplate ??
      globalThis.renderTemplate
   return render(path, data)
}

export function stripDamageTags(formula) {
   return String(formula || "").replace(/\[[^\]]+\]/g, "")
}
