const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"

export class SummaryDetailsApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.itemData = options.itemData
      this.type = options.type
   }

   static DEFAULT_OPTIONS = {
      id: "rnt-summary-details",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 450, height: "auto" },
      window: { title: `${MODULE_ID}.details` },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/summary-details.hbs`,
      },
   }

   async _prepareContext(options) {
      this.options.window.title =
         this.type === "thresholds"
            ? `Damage Thresholds: ${this.itemData.name}`
            : `Triggers: ${this.itemData.name}`
      return {
         item: this.itemData,
         isThresholds: this.type === "thresholds",
         isTriggers: this.type === "triggers",
      }
   }
}
