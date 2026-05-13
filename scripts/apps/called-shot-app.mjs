const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import {
   prepareBodyPartDisplay,
   getBodyPartHpColor,
   getBodyPartSaveMod,
} from "../utils.mjs"

export class CalledShotTargetApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.bodyParts = options.parts
      this.resolveCallback = options.resolve
      this.resolved = false
      this.isSave = options.isSave || false
      this.saveType = options.saveType || ""
   }

   static DEFAULT_OPTIONS = {
      id: "called-shot-target-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 400, height: "auto" },
      window: { title: `${MODULE_ID}.selectTarget` },
      actions: {
         selectMain: this._onSelectMain,
         selectPart: this._onSelectPart,
      },
   }

   static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/called-shot-app.hbs` },
   }

   async _prepareContext(options) {
      const hideAc =
         game.settings.get(MODULE_ID, "hideAcFromPlayers") && !game.user.isGM

      let hasChecked = false
      const partsData = this.bodyParts.map((p) => {
         const isDestroyed = p.hp.value <= 0
         let checked = false

         if (!isDestroyed && !p.isHidden && !hasChecked) {
            checked = true
            hasChecked = true
         }

         let saveMod = ""
         if (this.isSave && this.saveType && p.saves?.[this.saveType]) {
            saveMod = getBodyPartSaveMod(p, this.actor, this.saveType)
         }

         const displayData = prepareBodyPartDisplay(p, this.actor, true)
         return {
            ...p,
            acDisplay: displayData.acDisplay,
            hpDisplay: displayData.hpDisplay,
            hpColor: getBodyPartHpColor(p),
            isDestroyed,
            isHidden: p.isHidden,
            checked,
            saveMod,
         }
      })

      if (!hasChecked && partsData.length > 0) {
         const firstValid = partsData.find((p) => !p.isDestroyed)
         if (firstValid) firstValid.checked = true
      }

      return {
         parts: partsData,
         showAc: !this.isSave && !hideAc,
         isSave: this.isSave,
         saveType: this.saveType
            ? this.saveType.charAt(0).toUpperCase() + this.saveType.slice(1)
            : "",
      }
   }

   static async _onSelectMain(event, target) {
      this.resolved = true
      if (this.resolveCallback) this.resolveCallback({ type: "main" })
      this.close()
   }

   static async _onSelectPart(event, target) {
      const selected = this.element.querySelector(
         'input[name="rnt-part-select"]:checked',
      )
      if (!selected) return
      const partId = selected.value
      const part = this.bodyParts.find((p) => p.id === partId)

      if (part) {
         this.resolved = true
         if (this.resolveCallback) this.resolveCallback({ type: "part", part })
      }
      this.close()
   }

   _onClose() {
      if (!this.resolved && this.resolveCallback) {
         this.resolveCallback(null)
      }
      super._onClose()
   }
}
