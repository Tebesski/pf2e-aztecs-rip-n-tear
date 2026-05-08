const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"

export class SpellcastingConfigApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.partId = options.partId
      this.linkedEntries = options.linkedEntries || []
      this.linkedSpells = options.linkedSpells || []
      this.callback = options.callback
   }

   static DEFAULT_OPTIONS = {
      id: "spellcasting-config-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 400, height: 550 },
      window: { title: `${MODULE_ID}.spellcastingConfig` },
      actions: {
         saveConfig: this._onSaveConfig,
      },
   }

   static PARTS = {
      form: {
         template: `modules/${MODULE_ID}/templates/spellcasting-config.hbs`,
      },
   }

   async _prepareContext(options) {
      const entries = this.actor.itemTypes.spellcastingEntry.map((e) => {
         const spells = this.actor.itemTypes.spell.filter(
            (s) => s.system.location.value === e.id,
         )
         return {
            id: e.id,
            name: e.name,
            checked: this.linkedEntries.includes(e.id),
            spells: spells.map((s) => ({
               id: s.id,
               name: s.name,
               checked: this.linkedSpells.includes(s.id),
            })),
         }
      })

      return { entries }
   }

   static async _onSaveConfig(event, target) {
      const form = this.element.querySelector("form")
      const formData = new FormDataExtended(form)
      const data = foundry.utils.expandObject(formData.object)

      let entries = data.linkedEntries || []
      if (entries && !Array.isArray(entries)) entries = [entries]

      let spells = data.linkedSpells || []
      if (spells && !Array.isArray(spells)) spells = [spells]

      if (this.callback) {
         this.callback(entries, spells)
      } else {
         const parts = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "parts") || [],
         )
         const index = parts.findIndex((p) => p.id === this.partId)
         if (index !== -1) {
            parts[index].linkedEntries = entries
            parts[index].linkedSpells = spells
            await this.actor.setFlag(MODULE_ID, "parts", parts)
         }
      }

      this.close()
   }
}
