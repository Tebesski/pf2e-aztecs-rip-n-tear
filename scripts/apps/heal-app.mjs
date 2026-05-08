const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { applyBodyPartHealing } from "../mechanics.mjs"

export class HealBodyPartApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.partId = options.partId
      this.isHoT = false
   }

   static DEFAULT_OPTIONS = {
      id: "heal-body-part-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 300, height: "auto" },
      window: { title: `${MODULE_ID}.healBodyPart` },
      actions: {
         applyHeal: this._onApplyHeal,
         toggleHoT: this._onToggleHoT,
      },
   }

   static PARTS = {
      form: { template: `modules/${MODULE_ID}/templates/heal-app.hbs` },
   }

   async _prepareContext(options) {
      const parts = this.actor.getFlag(MODULE_ID, "parts") || []
      const part = parts.find((p) => p.id === this.partId) || {}
      return { part, isHoT: this.isHoT }
   }

   static async _onToggleHoT(event, target) {
      this.isHoT = target.checked
      this.render()
   }

   static async _onApplyHeal(event, target) {
      const form = this.element.querySelector("form")
      const formData = new FormDataExtended(form)
      const data = foundry.utils.expandObject(formData.object)

      if (this.isHoT) {
         const amount = parseInt(data.hotAmount) || 0
         const duration = parseInt(data.hotDuration) || 1

         if (amount > 0 && duration > 0) {
            const parts = this.actor.getFlag(MODULE_ID, "parts") || []
            const part = parts.find((p) => p.id === this.partId) || {}

            const effectData = {
               name: `Regeneration (${part.name})`,
               type: "effect",
               img: "icons/magic/life/heart-cross-green.webp",
               system: {
                  description: {
                     value: `Heals ${amount} HP per turn for ${duration} turns.`,
                  },
                  duration: {
                     value: duration,
                     unit: "rounds",
                     expiry: "turn-end",
                  },
               },
               flags: {
                  [MODULE_ID]: {
                     isHoT: true,
                     hotData: { partId: this.partId, amount },
                  },
               },
            }

            await this.actor.createEmbeddedDocuments("Item", [effectData])
            ChatMessage.create({
               speaker: ChatMessage.getSpeaker({ actor: this.actor }),
               content: `<strong>${part.name}</strong> is now regenerating ${amount} HP per turn for ${duration} turns.`,
            })
         }
      } else {
         const amount = parseInt(data.healAmount) || 0
         if (amount > 0) {
            await applyBodyPartHealing(this.actor, this.partId, amount)
         }
      }
      this.close()
   }
}
