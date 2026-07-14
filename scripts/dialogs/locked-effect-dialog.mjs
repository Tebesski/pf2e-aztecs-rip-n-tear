import { MODULE_ID } from "../constants.mjs"
import { withRntDialogTheme } from "../actor-support.mjs"

const TEMPLATE = `modules/${MODULE_ID}/templates/dialogs/locked-effect-choice.hbs`
const ICON_TEMPLATE = `modules/${MODULE_ID}/templates/dialogs/dialog-icon.hbs`

function renderTemplate(path, data) {
   const render =
      foundry.applications?.handlebars?.renderTemplate ??
      globalThis.renderTemplate
   return render(path, data)
}

export async function renderLockedEffectChoiceContent(partName) {
   return renderTemplate(TEMPLATE, { partName })
}

export async function promptLockedEffectChoice(actor, partName) {
   return foundry.applications.api.DialogV2.wait(
      withRntDialogTheme(
         {
            window: {
               title: game.i18n.localize(`${MODULE_ID}.lockedEffectTitle`),
            },
            content: await renderLockedEffectChoiceContent(partName),
            buttons: [
               {
                  action: "heal",
                  icon: "fa-solid fa-heart-circle-plus",
                  label: game.i18n.localize(`${MODULE_ID}.healBodyPart`),
               },
               {
                  action: "remove",
                  icon: "fa-solid fa-trash",
                  label: game.i18n.localize(`${MODULE_ID}.removeEffect`),
               },
               {
                  action: "cancel",
                  icon: "fa-solid fa-xmark",
                  label: game.i18n.localize(`${MODULE_ID}.cancel`),
               },
            ],
            default: "cancel",
         },
         actor,
      ),
   )
}

export async function renderLockedEffectLegacyDialog(
   actor,
   partName,
   { onHeal, onRemove },
) {
   const healIcon = await renderTemplate(ICON_TEMPLATE, {
      className: "fa-solid fa-heart-circle-plus",
   })
   const removeIcon = await renderTemplate(ICON_TEMPLATE, {
      className: "fa-solid fa-trash",
   })
   const cancelIcon = await renderTemplate(ICON_TEMPLATE, {
      className: "fa-solid fa-xmark",
   })

   new Dialog(
      {
         title: game.i18n.localize(`${MODULE_ID}.lockedEffectTitle`),
         content: await renderLockedEffectChoiceContent(partName),
         buttons: {
            heal: {
               icon: healIcon,
               label: game.i18n.localize(`${MODULE_ID}.healBodyPart`),
               callback: onHeal,
            },
            remove: {
               icon: removeIcon,
               label: game.i18n.localize(`${MODULE_ID}.removeEffect`),
               callback: onRemove,
            },
            cancel: {
               icon: cancelIcon,
               label: game.i18n.localize(`${MODULE_ID}.cancel`),
            },
         },
         default: "cancel",
      },
      withRntDialogTheme({ width: 520 }, actor),
   ).render(true)
}
