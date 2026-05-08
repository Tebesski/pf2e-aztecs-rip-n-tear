const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import {
   MODULE_ID,
   buildPf2eConditions,
   buildPf2eDamageTypes,
   PF2E_VALUED_CONDITIONS,
} from "../constants.mjs"
import { playSfx } from "../sfx.mjs"
import { captureActorSheetScroll } from "../sheet-injector.mjs"

const DOS_GROUPS = [
   { key: "criticalSuccess", label: "Critical Success" },
   { key: "success", label: "Success" },
   { key: "failure", label: "Failure" },
   { key: "criticalFailure", label: "Critical Failure" },
]

function decorateTriggers(triggers) {
   if (!triggers) return
   triggers.forEach((t) => {
      if (t.type === "condition") {
         t.hasValue = PF2E_VALUED_CONDITIONS.includes(t.slug || "blinded")
      }
      if (t.type === "saving-throw") {
         t.dosGroups = DOS_GROUPS.map((g) => ({
            key: g.key,
            label: g.label,
            actions: t.saveActions?.[g.key] || [],
         }))
      }
   })
}

function normalizeTriggerData(triggers, actor) {
   if (!triggers) return []
   const list = Object.values(triggers)
   for (const t of list) {
      t.damages = t.damages ? Object.values(t.damages) : []
      t.basicDamages = t.basicDamages ? Object.values(t.basicDamages) : []
      t.isBasicSave = !!t.isBasicSave
      if (t.invalid !== undefined) t.invalid = String(t.invalid) === "true"
      if (t.type === "condition" && !t.slug) t.slug = "blinded"

      if (t.type === "saving-throw") {
         if (!t.saveActions || Array.isArray(t.saveActions)) {
            t.saveActions = {
               criticalSuccess: [],
               success: [],
               failure: [],
               criticalFailure: [],
            }
         } else {
            for (const k of [
               "criticalSuccess",
               "success",
               "failure",
               "criticalFailure",
            ]) {
               t.saveActions[k] = t.saveActions[k]
                  ? Object.values(t.saveActions[k]).map((sa) => ({
                       ...sa,
                       invalid: String(sa.invalid) === "true",
                    }))
                  : []
            }
         }
         if (t.rollOptions === undefined) {
            const traits = actor?.system?.traits?.value || []
            t.rollOptions = traits.join(", ")
         }
      }
   }
   return list
}

function newTriggerDamage() {
   return { diceNum: 1, diceStep: "6", dmgType: "slashing", dmgCategory: "" }
}

function newSaveAction() {
   return {
      type: "damage",
      diceNum: 1,
      diceStep: "6",
      dmgType: "slashing",
      dmgCategory: "",
      uuid: "",
      slug: "blinded",
      value: 1,
   }
}

async function handleEffectUuidChange(ev) {
   const uuid = ev.currentTarget.value
   const parent =
      ev.currentTarget.closest(".effect-entry") ||
      ev.currentTarget.closest(".flexrow")
   const iconEl = parent.querySelector(".effect-icon")
   const nameEl = parent.querySelector(".effect-name-container")

   const setField = (selector, value) => {
      const input = parent.querySelector(selector)
      if (input) input.value = value
   }

   if (!uuid) {
      if (iconEl) iconEl.src = "icons/svg/mystery-man.svg"
      if (nameEl)
         nameEl.innerHTML = `<span style="color: gray;">Pending...</span>`
      setField('input[name$=".invalid"]', "false")
      return
   }

   const item = await fromUuid(uuid)
   if (!item || (item.type !== "effect" && item.documentName !== "Macro")) {
      if (iconEl) iconEl.src = "icons/svg/hazard.svg"
      if (nameEl)
         nameEl.innerHTML = `<span style="color: darkred; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Invalid Item</span>`
      setField('input[name$=".invalid"]', "true")
      setField('input[name$=".name"]', game.i18n.localize("pf2e-aztecs-rip-n-tear.invalidItem"))
      setField('input[name$=".img"]', "icons/svg/hazard.svg")
      ui.notifications.warn(
         "The provided UUID does not exist, or is not an Effect/Macro.",
      )
   } else {
      if (iconEl) iconEl.src = item.img || "icons/svg/dice-target.svg"
      if (nameEl)
         nameEl.innerHTML = `<a class="content-link rnt-effect-link" data-uuid="${uuid}"><i class="fa-solid ${item.documentName === "Macro" ? "fa-code" : "fa-suitcase"}"></i> ${item.name}</a>`
      setField('input[name$=".invalid"]', "false")
      setField('input[name$=".name"]', item.name)
      setField('input[name$=".img"]', item.img || "icons/svg/dice-target.svg")
   }
}

export class DeathReactionApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.workingReaction = null
   }

   static DEFAULT_OPTIONS = {
      id: "death-reaction-editor",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 550, height: 700 },
      window: { title: `${MODULE_ID}.deathReactionEditor` },
      actions: {
         saveChanges: this._onSaveChanges,
         addTrigger: this._onAddTrigger,
         removeTrigger: this._onRemoveTrigger,
         addTriggerDamage: this._onAddTriggerDamage,
         removeTriggerDamage: this._onRemoveTriggerDamage,
         addBasicDamage: this._onAddBasicDamage,
         removeBasicDamage: this._onRemoveBasicDamage,
         pickFile: this._onPickFile,
         previewSfx: this._onPreviewSfx,
         addSaveAction: this._onAddSaveAction,
         removeSaveAction: this._onRemoveSaveAction,
      },
   }

   static PARTS = {
      form: {
         template: `modules/${MODULE_ID}/templates/death-reaction-editor.hbs`,
      },
   }

   async _prepareContext(options) {
      if (!this.workingReaction) {
         this.workingReaction = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "deathReaction") || {
               id: foundry.utils.randomID(),
               name: "New Death Reaction",
               useDelay: false,
               delayRounds: 1,
               expiry: "turn-end",
               sfxTrigger: "",
               triggers: [],
            },
         )
      }

      const dr = foundry.utils.deepClone(this.workingReaction)
      decorateTriggers(dr.triggers)

      return {
         dr,
         pf2eConditions: buildPf2eConditions(),
         pf2eDamageTypes: buildPf2eDamageTypes(),
      }
   }

   async _saveCurrentState() {
      const form = this.element.querySelector("form")
      if (!form) return
      const formData = new FormDataExtended(form)
      const data = foundry.utils.expandObject(formData.object)

      data.useDelay = !!data.useDelay
      data.triggers = normalizeTriggerData(data.triggers, this.actor)
      data.id = this.workingReaction.id
      this.workingReaction = data
   }

   static async _onSaveChanges(event, target) {
      await this._saveCurrentState()
      captureActorSheetScroll(this.actor)
      await this.actor.setFlag(
         MODULE_ID,
         "deathReaction",
         this.workingReaction,
      )
      this.close()
   }

   _saveScrollPos() {
      const form = this.element?.querySelector(".rnt-scrollable")
      if (form) window.RNT_DEATH_REACTION_SCROLL = form.scrollTop
   }

   _restoreScrollPos() {
      const restore = () => {
         const form = this.element?.querySelector(".rnt-scrollable")
         if (form && form.isConnected && window.RNT_DEATH_REACTION_SCROLL !== undefined) {
            form.scrollTop = window.RNT_DEATH_REACTION_SCROLL
         }
      }
      restore()
      requestAnimationFrame(() => requestAnimationFrame(restore))
      setTimeout(restore, 50)
   }

   _onRender(context, options) {
      super._onRender(context, options)
      this._restoreScrollPos()

      const reRenderOnChange = async () => {
         await this._saveCurrentState()
         this._saveScrollPos()
         this.render()
      }

      this.element.addEventListener("click", async (ev) => {
         const effectLink = ev.target.closest(".rnt-effect-link")
         if (effectLink) {
            const uuid = effectLink.dataset.uuid
            const item = await fromUuid(uuid)
            if (item) item.sheet.render(true)
         }
      })

      const delayCheck = this.element.querySelector('input[name="useDelay"]')
      if (delayCheck) delayCheck.addEventListener("change", reRenderOnChange)

      this.element
         .querySelectorAll('input[type="checkbox"][name$=".isBasicSave"]')
         .forEach((el) => el.addEventListener("change", reRenderOnChange))

      this.element
         .querySelectorAll(
            'select[name^="triggers."][name$=".type"], select[name^="triggers."][name$=".target"]',
         )
         .forEach((el) => el.addEventListener("change", reRenderOnChange))

      this.element.querySelectorAll(".rnt-effect-uuid-input").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            await handleEffectUuidChange(ev)
            await this._saveCurrentState()
         })
      })

      this.element
         .querySelectorAll(".rnt-condition-select")
         .forEach((el) => el.addEventListener("change", reRenderOnChange))
   }

   static async _onAddTrigger(event, target) {
      await this._saveCurrentState()
      this.workingReaction.triggers.push({
         type: "damage",
         target: "triggerer",
         radius: 15,
         targetFilters: "enemies",
         damages: [newTriggerDamage()],
      })
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveTrigger(event, target) {
      const index = parseInt(target.dataset.index, 10)
      await this._saveCurrentState()
      this.workingReaction.triggers.splice(index, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddTriggerDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingReaction.triggers[ti].damages.push(newTriggerDamage())
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveTriggerDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const di = parseInt(target.dataset.di, 10)
      await this._saveCurrentState()
      this.workingReaction.triggers[ti].damages.splice(di, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddBasicDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      const trig = this.workingReaction.triggers[ti]
      if (!trig.basicDamages) trig.basicDamages = []
      trig.basicDamages.push(newTriggerDamage())
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveBasicDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const bdi = parseInt(target.dataset.bdi, 10)
      await this._saveCurrentState()
      this.workingReaction.triggers[ti].basicDamages.splice(bdi, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddSaveAction(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const dos = target.dataset.dos
      await this._saveCurrentState()

      if (!this.workingReaction) return
      if (!this.workingReaction.triggers) this.workingReaction.triggers = []
      const trig = this.workingReaction.triggers[ti]
      if (!trig) return
      trig.type = "saving-throw"
      if (!trig.saveActions || typeof trig.saveActions !== "object" || Array.isArray(trig.saveActions))
         trig.saveActions = {
            criticalSuccess: [],
            success: [],
            failure: [],
            criticalFailure: [],
         }
      if (!Array.isArray(trig.saveActions[dos])) trig.saveActions[dos] = []

      trig.saveActions[dos].push(newSaveAction())
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveSaveAction(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const dos = target.dataset.dos
      const sai = parseInt(target.dataset.sai, 10)
      await this._saveCurrentState()
      const trig = this.workingReaction.triggers?.[ti]
      if (!trig?.saveActions?.[dos]) return
      trig.saveActions[dos].splice(sai, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onPickFile(event, target) {
      const input = target.closest(".rnt-sfx-field, .rnt-field-control, .rnt-sfx-row, .flexrow, .form-fields")?.querySelector("input[type='text']") || target.previousElementSibling
      new FilePicker({
         type: "audio",
         current: input.value,
         callback: (path) => {
            input.value = path
         },
      }).browse(input.value)
   }

   static async _onPreviewSfx(event, target) {
      const input = target.closest(".rnt-sfx-field, .rnt-field-control, .rnt-sfx-row, .flexrow, .form-fields")?.querySelector("input[type='text']") || target.previousElementSibling.previousElementSibling
      if (input.value) await playSfx(input.value, "deathReaction", true)
   }
}
