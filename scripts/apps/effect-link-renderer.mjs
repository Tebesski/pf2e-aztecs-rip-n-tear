import { MODULE_ID } from "../constants.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates/apps`

function renderTemplate(path, data) {
   const render =
      foundry.applications?.handlebars?.renderTemplate ??
      globalThis.renderTemplate
   return render(path, data)
}

export function renderPendingEffectLabel() {
   return renderTemplate(`${TEMPLATE_BASE}/effect-pending-label.hbs`, {
      label: game.i18n.localize(`${MODULE_ID}.pending`),
   })
}

export function renderInvalidEffectLabel() {
   return renderTemplate(`${TEMPLATE_BASE}/effect-invalid-label.hbs`, {
      label: game.i18n.localize(`${MODULE_ID}.invalidItem`),
   })
}

export function renderEffectContentLink(item, uuid) {
   return renderTemplate(`${TEMPLATE_BASE}/effect-content-link.hbs`, {
      uuid,
      icon: item.documentName === "Macro" ? "fa-code" : "fa-suitcase",
      name: item.name,
   })
}
