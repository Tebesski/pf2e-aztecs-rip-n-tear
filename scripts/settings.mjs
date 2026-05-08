import { MODULE_ID, SFX_KEYS } from "./constants.mjs"

function registerBoolean(key, name, defaultValue, hint) {
   const config = {
      name,
      scope: "world",
      config: true,
      type: Boolean,
      default: defaultValue,
   }
   if (hint) config.hint = hint
   game.settings.register(MODULE_ID, key, config)
}

function registerString(key, name, defaultValue) {
   game.settings.register(MODULE_ID, key, {
      name,
      scope: "world",
      config: true,
      type: String,
      default: defaultValue,
   })
}

function registerVolumeSlider(key, name) {
   game.settings.register(MODULE_ID, key, {
      name,
      scope: "world",
      config: true,
      type: Number,
      default: 0.8,
      range: { min: 0, max: 1, step: 0.05 },
   })
}

export function registerSettings() {
   registerBoolean("enableCalledShots", "Enable Called Shots", true)
   registerBoolean("useHpText", "Replace HP numbers with status text", true)
   registerBoolean(
      "hideAcFromPlayers",
      "Hide Body Part Armour Class from Players",
      true,
   )

   registerString("textDestroyed", "Text for 0% HP", "Destroyed")
   registerString("textMutilated", "Text for 1-25% HP", "Mutilated")
   registerString("textSevere", "Text for 26-50% HP", "Severely damaged")
   registerString("textBarely", "Text for 51-99% HP", "Barely damaged")
   registerString("textIntact", "Text for 100% HP", "Intact")

   registerBoolean(
      "promptFreeActions",
      "Prompt GM for Free Action Reactions",
      true,
      "If unchecked, Damage Reactions set as 'Free Action' will trigger automatically without a confirmation dialog.",
   )

   registerVolumeSlider(SFX_KEYS.deathReaction, "SFX Volume: Death Reaction")
   registerVolumeSlider(SFX_KEYS.damageReaction, "SFX Volume: Damage Reaction")
   registerVolumeSlider(SFX_KEYS.damage, "SFX Volume: Body Part Damage")
   registerVolumeSlider(SFX_KEYS.heal, "SFX Volume: Body Part Heal")
   registerVolumeSlider(SFX_KEYS.destroy, "SFX Volume: Body Part Destroyed")

   game.settings.register(MODULE_ID, "templates", {
      name: "templates",
      scope: "world",
      config: false,
      type: Object,
      default: [],
   })

   game.settings.registerMenu(MODULE_ID, "manageTemplatesMenu", {
      name: `${MODULE_ID}.manageTemplates`,
      label: `${MODULE_ID}.manageTemplates`,
      hint: `${MODULE_ID}.manageTemplatesHint`,
      icon: "fa-solid fa-puzzle-piece",
      type: ManageTemplatesShim,
      restricted: true,
   })
}

const FormApplicationBase =
   foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication

class ManageTemplatesShim extends FormApplicationBase {
   constructor(...args) {
      super(...args)
   }

   static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
         id: "rnt-manage-templates-shim",
         title: "Manage Templates",
         template: "templates/generic/form.html",
         width: 400,
         height: "auto",
         popOut: false,
      })
   }

   async _render(force, options) {
      const m = await import("./apps/manage-templates-app.mjs")
      new m.ManageTemplatesApp().render(true)
   }

   async _updateObject() {}
}
