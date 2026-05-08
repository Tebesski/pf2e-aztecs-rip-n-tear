const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"

export class LinkedItemsApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.partId = options.partId
      this.linkType = options.linkType
   }

   static DEFAULT_OPTIONS = {
      id: "linked-items-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 350, height: "auto" },
      window: { title: `${MODULE_ID}.linkedItems` },
      actions: {
         unlinkItem: this._onUnlinkItem,
         openItem: this._onOpenItem,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/linked-items-app.hbs`,
      },
   }

   async _prepareContext(options) {
      const parts = this.actor.getFlag(MODULE_ID, "parts") || []
      const part = parts.find((p) => p.id === this.partId) || {}

      const items = []
      const pushIfFound = (id, icon) => {
         const item = this.actor.items.get(id)
         if (item) items.push({ id: item.id, name: item.name, icon })
      }

      if (this.linkType === "spells") {
         if (part.linkedEntries) {
            for (const eid of part.linkedEntries)
               pushIfFound(eid, "fa-book-sparkles")
         }
         if (part.linkedSpells) {
            for (const sid of part.linkedSpells)
               pushIfFound(sid, "fa-wand-magic-sparkles")
         }
      } else if (this.linkType === "abilities") {
         if (part.linkedItems) {
            for (const id of part.linkedItems) {
               if (id === "ALL_SPELLCASTING") continue
               pushIfFound(id, "fa-suitcase")
            }
         }
      }

      return { part, items, linkType: this.linkType }
   }

   static async _onUnlinkItem(event, target) {
      const itemId = target.dataset.id
      const parts = foundry.utils.deepClone(
         this.actor.getFlag(MODULE_ID, "parts") || [],
      )
      const part = parts.find((p) => p.id === this.partId)
      if (!part) return

      if (this.linkType === "spells") {
         if (part.linkedEntries?.includes(itemId)) {
            part.linkedEntries = part.linkedEntries.filter(
               (id) => id !== itemId,
            )
         } else if (part.linkedSpells?.includes(itemId)) {
            part.linkedSpells = part.linkedSpells.filter((id) => id !== itemId)
         }
      } else if (this.linkType === "abilities") {
         if (part.linkedItems) {
            part.linkedItems = part.linkedItems.filter((id) => id !== itemId)
         }
      }

      await this.actor.setFlag(MODULE_ID, "parts", parts)
      this.render()
   }

   static async _onOpenItem(event, target) {
      const itemId = target.dataset.id
      const item = this.actor.items.get(itemId)
      if (item) item.sheet.render(true)
   }
}
