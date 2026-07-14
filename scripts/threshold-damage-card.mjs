import { MODULE_ID } from "./constants.mjs"
import { CARD_FLAG, localize } from "./threshold-card/constants.mjs"
import {
   applyCardDamage,
   damageFormula,
   rollFormula,
} from "./threshold-card/damage.mjs"
import {
   renderCard,
   renderRollBlock,
} from "./threshold-card/rendering.mjs"
import {
   canUseTarget,
   targetDocsForTargets,
   targetTokenDocs,
} from "./threshold-card/targets.mjs"

export class RntThresholdDamageCardManager {
   static initHooks() {
      Hooks.once("ready", () => this._installListeners())
   }

   static async postThresholdDamageCard({
      formula,
      targets = [],
      sourceActor = null,
      part = null,
   } = {}) {
      const targetDocs = targetDocsForTargets(targets)
      if (targetDocs.length < 1 || !formula || formula === "0") return false
      targetTokenDocs(targetDocs)

      const content = await renderCard({
         formula,
         targetDocs,
         sourceActor,
         part,
      })

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: sourceActor || targets[0] }),
         content,
         flags: {
            [MODULE_ID]: {
               [CARD_FLAG]: {
                  mode: "damage",
                  formula,
                  rollData: null,
                  targetHpRolls: {},
                  targetUuids: targetDocs.map((doc) => doc.uuid),
                  sourceActorUuid: sourceActor?.uuid || null,
                  partId: part?.id || null,
                  partName: part?.name || null,
               },
            },
         },
      })
      return true
   }

   static async gmApplyCardDamage(payload = {}) {
      return applyCardDamage(payload)
   }

   static async gmPersistCard(payload = {}) {
      const message = payload?.messageId
         ? game.messages.get(payload.messageId)
         : null
      if (!message) return false

      const update = {}
      if (typeof payload.content === "string") update.content = payload.content
      if (payload.cardData)
         update[`flags.${MODULE_ID}.${CARD_FLAG}`] = payload.cardData

      if (Object.keys(update).length === 0) return false
      await message.update(update)
      return true
   }

   static _installListeners() {
      if (this._listenersInstalled) return
      this._listenersInstalled = true

      document.addEventListener("click", (event) => {
         const control = event.target.closest?.(
            "[data-rnt-threshold-damage-action]",
         )
         if (!control) return
         const card = control.closest(".rnt-threshold-damage-card")
         if (!card) return
         event.preventDefault()
         this._handleCardClick(control, card)
      })
   }

   static async _handleCardClick(control, card) {
      const action = control.dataset.rntThresholdDamageAction
      if (action === "expand-roll") {
         const roll = control.closest(".dice-roll")
         roll?.classList.toggle("expanded")
         return
      }

      const row = control.closest("[data-target-uuid]")
      const targetUuid = row?.dataset.targetUuid
      if (!targetUuid) return

      const messageId = card.closest(".message")?.dataset.messageId
      const message = messageId ? game.messages.get(messageId) : null
      const data = message?.getFlag(MODULE_ID, CARD_FLAG)
      if (!data) return

      if (!(await canUseTarget(targetUuid))) {
         ui.notifications.warn(localize("thresholdDamageCardOwnerOnly"))
         return
      }

      const hpRoll = await this._ensureCardHpRoll({
         data,
         control,
         targetUuid,
         card,
      })
      if (!hpRoll?.rollData) return

      await this._routeCardAction("applyThresholdDamageCardDamage", {
         targetUuid,
         multiplier: Number(control.dataset.multiplier || 1),
         damage: hpRoll.rollData,
      })

      await this._markApplied(control)
   }

   static async _routeCardAction(handler, payload) {
      if (game.user.isGM) return applyCardDamage(payload)
      if (!globalThis.ripAndTearSocket) {
         ui.notifications.error(localize("socketlibRequired"))
         return false
      }
      return globalThis.ripAndTearSocket.executeAsGM(handler, payload)
   }

   static async _markApplied(control, cardData = null) {
      const row = control.closest(".siege-consequence-target-row")
      const application = control.closest(".siege-consequence-application")
      application?.classList.add("applied")
      if (application) application.style.filter = "blur(1px) opacity(0.55)"
      row?.classList.add("applied")

      const card = control.closest(".rnt-threshold-damage-card")
      await this._persistCardContent(card, cardData ? { cardData } : {})
   }

   static async _ensureCardHpRoll({
      data,
      control,
      targetUuid,
      card,
   } = {}) {
      const existing = data?.targetHpRolls?.[targetUuid]?.primary
      if (existing) return existing
      if (!data?.formula || !targetUuid) return null

      const rollData = await rollFormula(data.formula)
      const entry = {
         key: "primary",
         mode: "damage",
         rollData,
      }
      data.targetHpRolls = foundry.utils.deepClone(data.targetHpRolls || {})
      data.targetHpRolls[targetUuid] = {
         ...(data.targetHpRolls[targetUuid] || {}),
         primary: entry,
      }

      const row = control.closest(".target-row")
      const slot = row?.querySelector(".siege-target-roll-slot")
      if (slot)
         slot.innerHTML = await renderRollBlock(
            rollData,
            localize("thresholdDamageCardDamage"),
         )

      await this._persistCardContent(card, { cardData: data })
      return entry
   }

   static async _persistCardContent(card, { cardData = null } = {}) {
      const messageId = card?.closest(".message")?.dataset.messageId
      const message = messageId ? game.messages.get(messageId) : null
      if (!message || !card) return false

      const payload = {
         messageId,
         content: card.outerHTML,
         cardData,
      }

      if (game.user.isGM) {
         await this.gmPersistCard(payload).catch(() => {})
         return true
      }

      if (globalThis.ripAndTearSocket) {
         await globalThis.ripAndTearSocket
            .executeAsGM("persistThresholdDamageCard", payload)
            .catch(() => {})
         return true
      }

      await message.update({ content: card.outerHTML }).catch(() => {})
      return true
   }

   static damageFormula(entries = []) {
      return damageFormula(entries)
   }
}
