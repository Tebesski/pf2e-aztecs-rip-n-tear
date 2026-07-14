import { MODULE_ID } from "../constants.mjs"

const MESSAGE_TEMPLATE = `modules/${MODULE_ID}/templates/dialogs/message.hbs`
const REACTION_REQUIREMENTS_TEMPLATE = `modules/${MODULE_ID}/templates/dialogs/reaction-requirements.hbs`

function renderTemplate(path, data) {
   const render =
      foundry.applications?.handlebars?.renderTemplate ??
      globalThis.renderTemplate
   return render(path, data)
}

export function renderDialogMessage(message) {
   return renderTemplate(MESSAGE_TEMPLATE, { message })
}

export function renderReactionRequirements(types) {
   return renderTemplate(REACTION_REQUIREMENTS_TEMPLATE, { types })
}
