const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { withRntActorTheme } from "../actor-support.mjs"

export class AbilityLinkedPartsApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      options = withRntActorTheme(options)
      super(options)
      this.actor = options.actor
      this.itemId = options.itemId
      this.itemName = options.itemName || ""
   }

   static DEFAULT_OPTIONS = {
      id: "ability-linked-parts-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 360, height: "auto" },
      window: { title: `${MODULE_ID}.linkedBodyParts` },
      actions: {
         openPart: this._onOpenPart,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/ability-linked-parts.hbs`,
      },
   }

   async _prepareContext(options) {
      const allParts = this.actor.getFlag(MODULE_ID, "parts") || []
      const matched = []
      for (const p of allParts) {
         const hasDirect = (p.linkedItems || []).includes(this.itemId)
         const hasEntry = (p.linkedEntries || []).includes(this.itemId)
         const hasSpell = (p.linkedSpells || []).includes(this.itemId)
         const allCasting = (p.linkedItems || []).includes("ALL_SPELLCASTING")
         const isThisACastingItem = this._isCastingItem(this.itemId)
         if (
            hasDirect ||
            hasEntry ||
            hasSpell ||
            (allCasting && isThisACastingItem)
         ) {
            matched.push({
               id: p.id,
               name: p.name,
               hp: p.hp.value,
               max: p.hp.max,
               isDestroyed: p.hp.value <= 0,
            })
         }
      }
      return { itemName: this.itemName, parts: matched }
   }

   _isCastingItem(itemId) {
      const item = this.actor.items.get(itemId)
      if (!item) return false
      return item.type === "spell" || item.type === "spellcastingEntry"
   }

   static async _onOpenPart(event, target) {
      const partId = target.dataset.partId
      this.close()
      const m = await import("./body-part-app.mjs")
      new m.BodyPartApp({ actor: this.actor, partId }).render(true)
   }
}
