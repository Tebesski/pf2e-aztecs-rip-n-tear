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
   registerBoolean("enableCalledShots", `${MODULE_ID}.enableCalledShots`, true)

   registerBoolean(
      "promptFreeActions",
      `${MODULE_ID}.promptFreeActions`,
      true,
      `${MODULE_ID}.promptFreeActionsHint`,
   )

   registerBoolean("hideAcFromPlayers", `${MODULE_ID}.hideAcFromPlayers`, true)

   game.settings.register(MODULE_ID, "showAcDifference", {
      name: `${MODULE_ID}.showAcDifference`,
      hint: `${MODULE_ID}.showAcDifferenceHint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
   })

   game.settings.register(MODULE_ID, "usePercentageHp", {
      name: `${MODULE_ID}.usePercentageHp`,
      hint: `${MODULE_ID}.usePercentageHpHint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: (value) => {
         if (value) game.settings.set(MODULE_ID, "useHpText", false)
      },
   })

   game.settings.register(MODULE_ID, "useHpText", {
      name: `${MODULE_ID}.useHpText`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: (value) => {
         if (value) game.settings.set(MODULE_ID, "usePercentageHp", false)
      },
   })

   registerString(
      "textDestroyed",
      `${MODULE_ID}.textDestroyedName`,
      game.i18n.localize(`${MODULE_ID}.textDestroyedDefault`),
   )
   registerString(
      "textMutilated",
      `${MODULE_ID}.textMutilatedName`,
      game.i18n.localize(`${MODULE_ID}.textMutilatedDefault`),
   )
   registerString(
      "textSevere",
      `${MODULE_ID}.textSevereName`,
      game.i18n.localize(`${MODULE_ID}.textSevereDefault`),
   )
   registerString(
      "textBarely",
      `${MODULE_ID}.textBarelyName`,
      game.i18n.localize(`${MODULE_ID}.textBarelyDefault`),
   )
   registerString(
      "textIntact",
      `${MODULE_ID}.textIntactName`,
      game.i18n.localize(`${MODULE_ID}.textIntactDefault`),
   )

   game.settings.register(MODULE_ID, "muteManualHpSfx", {
      name: `${MODULE_ID}.muteManualHpSfx`,
      hint: `${MODULE_ID}.muteManualHpSfxHint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
   })

   registerVolumeSlider(
      SFX_KEYS.deathReaction,
      `${MODULE_ID}.sfxVolumeDeathReaction`,
   )
   registerVolumeSlider(
      SFX_KEYS.damageReaction,
      `${MODULE_ID}.sfxVolumeDamageReaction`,
   )
   registerVolumeSlider(SFX_KEYS.damage, `${MODULE_ID}.sfxVolumeBodyPartDamage`)
   registerVolumeSlider(SFX_KEYS.heal, `${MODULE_ID}.sfxVolumeBodyPartHeal`)
   registerVolumeSlider(
      SFX_KEYS.destroy,
      `${MODULE_ID}.sfxVolumeBodyPartDestroyed`,
   )

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

Hooks.on("renderSettingsConfig", (app, htmlData) => {
   const html = htmlData instanceof HTMLElement ? htmlData : htmlData[0]
   if (!html) return

   const updateUI = () => {
      const hideAcToggle = html.querySelector(
         `input[name="pf2e-aztecs-rip-n-tear.hideAcFromPlayers"]`,
      )
      const showAcDiffInput = html.querySelector(
         `input[name="pf2e-aztecs-rip-n-tear.showAcDifference"]`,
      )

      if (hideAcToggle && showAcDiffInput) {
         const formGroup = showAcDiffInput.closest(".form-group")
         if (formGroup) {
            formGroup.style.display = hideAcToggle.checked ? "none" : ""
         }
      }

      const useTextToggle = html.querySelector(
         `input[name="pf2e-aztecs-rip-n-tear.useHpText"]`,
      )
      if (useTextToggle) {
         const isTextEnabled = useTextToggle.checked
         const textSettings = [
            "textDestroyed",
            "textMutilated",
            "textSevere",
            "textBarely",
            "textIntact",
         ]

         textSettings.forEach((settingName) => {
            const input = html.querySelector(
               `input[name="pf2e-aztecs-rip-n-tear.${settingName}"]`,
            )
            if (input) {
               const formGroup = input.closest(".form-group")
               if (formGroup) {
                  formGroup.style.display = isTextEnabled ? "" : "none"
               }
            }
         })
      }
   }

   updateUI()

   html.addEventListener("change", (e) => {
      const targetName = e.target.name

      if (targetName === "pf2e-aztecs-rip-n-tear.usePercentageHp") {
         if (e.target.checked) {
            const useTextToggle = html.querySelector(
               `input[name="pf2e-aztecs-rip-n-tear.useHpText"]`,
            )
            if (useTextToggle && useTextToggle.checked) {
               useTextToggle.checked = false
            }
         }
      } else if (targetName === "pf2e-aztecs-rip-n-tear.useHpText") {
         if (e.target.checked) {
            const usePctToggle = html.querySelector(
               `input[name="pf2e-aztecs-rip-n-tear.usePercentageHp"]`,
            )
            if (usePctToggle && usePctToggle.checked) {
               usePctToggle.checked = false
            }
         }
      }

      if (
         targetName === "pf2e-aztecs-rip-n-tear.hideAcFromPlayers" ||
         targetName === "pf2e-aztecs-rip-n-tear.usePercentageHp" ||
         targetName === "pf2e-aztecs-rip-n-tear.useHpText"
      ) {
         updateUI()
      }
   })
})

class ManageTemplatesShim extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "rnt-manage-templates-shim",
      window: { title: `${MODULE_ID}.manageTemplates` },
   }

   render(force, options) {
      import("./apps/manage-templates-app.mjs").then((m) => {
         new m.ManageTemplatesApp().render(true)
      })
      return this
   }
}
