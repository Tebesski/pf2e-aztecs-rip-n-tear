const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { applyBodyPartDamage } from "../mechanics.mjs"

export class PersistentDamageApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      options.id = `rnt-persistent-${options.effect?.id || foundry.utils.randomID()}`
      super(options)
      this.actor = options.actor
      this.token = options.token
      this.effect = options.effect
      this.flags = this.effect.getFlag(MODULE_ID, "persistentData")
   }

   static DEFAULT_OPTIONS = {
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 320, height: "auto" },
      window: { title: `${MODULE_ID}.persistentDamage` },
      actions: {
         dealDamage: this._onDealDamage,
         rollRecovery: this._onRollRecovery,
         removeEffect: this._onRemoveEffect,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/persistent-dialog.hbs`,
      },
   }

   async _prepareContext(options) {
      const parts = this.actor.getFlag(MODULE_ID, "parts") || []
      const part = parts.find((p) => p.id === this.flags.partId) || {}

      const iwrImmune =
         part.customIWR && part.iwr?.immune
            ? part.iwr.immune
            : this.actor.system.attributes.immunities
                 ?.map((x) => x.type)
                 .join(", ") || "None"
      const iwrWeak =
         part.customIWR && part.iwr?.weak
            ? part.iwr.weak
            : this.actor.system.attributes.weaknesses
                 ?.map((x) => `${x.type} ${x.value}`)
                 .join(", ") || "None"
      const iwrResist =
         part.customIWR && part.iwr?.resist
            ? part.iwr.resist
            : this.actor.system.attributes.resistances
                 ?.map((x) => `${x.type} ${x.value}`)
                 .join(", ") || "None"

      const rememberedDc = this.token?.document?.getFlag(
         MODULE_ID,
         "recoveryDc",
      )

      const headlineHtml = game.i18n.format(`${MODULE_ID}.persistentHeadline`, {
         actorName: `<strong>${this.actor.name}</strong>`,
         partName: `<strong>${part.name}</strong>`,
      })

      return {
         actorName: this.actor.name,
         headlineHtml,
         part,
         amount: this.flags.amount,
         dmgType: this.flags.dmgType,
         iwrImmune,
         iwrWeak,
         iwrResist,
         defaultDc: rememberedDc || 15,
         rememberDc: !!rememberedDc,
      }
   }

   async _dealPersistentDamage() {
      let amountToDeal = this.flags.amount
      if (typeof amountToDeal === "string" && amountToDeal.includes("d")) {
         const roll = await new Roll(amountToDeal).evaluate()
         await roll.toMessage({
            speaker: ChatMessage.getSpeaker({
               actor: this.actor,
               token: this.token,
            }),
            flavor: `Persistent ${this.flags.dmgType} Damage`,
         })
         amountToDeal = roll.total
      } else {
         amountToDeal = parseInt(amountToDeal) || 0
      }
      await applyBodyPartDamage(
         this.actor,
         this.flags.partId,
         amountToDeal,
         this.flags.dmgType,
         "persistent-tick",
      )
   }

   static async _onDealDamage(event, target) {
      await this._dealPersistentDamage()
      this.close()
   }

   static async _onRollRecovery(event, target) {
      await this._dealPersistentDamage()

      const dcInput = this.element.querySelector("#recoveryDc")
      const rememberInput = this.element.querySelector("#rememberDc")
      const dc = parseInt(dcInput.value) || 15

      if (rememberInput.checked && this.token?.document) {
         await this.token.document.setFlag(MODULE_ID, "recoveryDc", dc)
      } else if (!rememberInput.checked && this.token?.document) {
         await this.token.document.unsetFlag(MODULE_ID, "recoveryDc")
      }

      const roll = await new Roll("1d20").evaluate()
      const success = roll.total >= dc

      await roll.toMessage({
         speaker: ChatMessage.getSpeaker({
            actor: this.actor,
            token: this.token,
         }),
         flavor: `<strong>Flat Check (Recovery)</strong> vs DC ${dc}<br>${success ? "<span style='color:green;'>Success!</span> Persistent damage removed." : "<span style='color:darkred;'>Failure!</span> Persistent damage remains."}`,
      })

      if (success) await this.effect.delete()
      this.close()
   }

   static async _onRemoveEffect(event, target) {
      await this.effect.delete()
      this.close()
   }
}
