import { MODULE_ID } from "../constants.mjs"
import { strongText } from "../html-format.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates/chat`

function renderTemplate(path, data) {
   const render =
      foundry.applications?.handlebars?.renderTemplate ??
      globalThis.renderTemplate
   return render(path, data)
}

export function renderConsequenceDamageFlavor({ sourceName, targetName }) {
   return renderTemplate(`${TEMPLATE_BASE}/consequence-damage-flavor.hbs`, {
      sourceName,
      message: game.i18n.format(`${MODULE_ID}.consequenceDamageFlavor`, {
         targetName: strongText(targetName),
      }),
   })
}

export function renderCalledShotFlavor(partName) {
   const wrapper = document.createElement("div")
   wrapper.style.fontWeight = "600"
   wrapper.style.color = "var(--rnt-accent)"
   wrapper.style.marginTop = "4px"

   const icon = document.createElement("i")
   icon.className = "fa-solid fa-crosshairs"
   wrapper.appendChild(icon)
   wrapper.appendChild(
      document.createTextNode(
         ` ${game.i18n.format(`${MODULE_ID}.calledShotFlavorLabel`, {
            partName,
         })}`,
      ),
   )
   return wrapper.outerHTML
}
