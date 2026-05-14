const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api
import { RuleElementApp } from "./rule-element-app.mjs"

import {
   MODULE_ID,
   buildPf2eConditions,
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
      setField(
         'input[name$=".name"]',
         game.i18n.localize("pf2e-aztecs-rip-n-tear.invalidItem"),
      )
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

export class ReactionApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.reactionId = options.reactionId
      this.workingReactions = null
   }

   static DEFAULT_OPTIONS = {
      id: "reaction-editor",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 550, height: 700 },
      window: { title: `${MODULE_ID}.reactionEditor` },
      actions: {
         saveChanges: this._onSaveChanges,
         removeReactionDmg: this._onRemoveReactionDmg,
         removeReactionPart: this._onRemoveReactionPart,
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
         buildRuleElement: this._onBuildRuleElement,
      },
   }

   static PARTS = {
      form: {
         template: `modules/${MODULE_ID}/templates/reaction-editor.hbs`,
      },
   }

   _getReaction() {
      return this.workingReactions.find((r) => r.id === this.reactionId)
   }

   async _prepareContext(options) {
      if (!this.workingReactions) {
         this.workingReactions = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "reactions") || [],
         )
      }

      const rx = this._getReaction()
      const actorParts = this.actor.getFlag(MODULE_ID, "parts") || []

      const availableParts = actorParts.filter(
         (p) => !(rx.specificParts || []).includes(p.id),
      )
      const rxParts = (rx.specificParts || []).map((id) => {
         const p = actorParts.find((x) => x.id === id)
         return {
            id,
            name: p
               ? p.name
               : game.i18n.localize("pf2e-aztecs-rip-n-tear.unknownPart"),
         }
      })

      const pf2eDamageTypes = Object.entries(CONFIG.PF2E.damageTypes)
         .map(([k, v]) => ({ slug: k, label: game.i18n.localize(v) }))
         .filter((dt) => !(rx.damageTypes || []).includes(dt.slug))
         .sort((a, b) => a.label.localeCompare(b.label))

      const rxDamageTypes = (rx.damageTypes || []).map((slug) => ({
         slug,
         label: game.i18n.localize(CONFIG.PF2E.damageTypes[slug] || slug),
      }))

      decorateTriggers(rx.triggers)

      return {
         rx,
         availableParts,
         rxParts,
         pf2eDamageTypes,
         rxDamageTypes,
         pf2eConditions: buildPf2eConditions(),
      }
   }

   async _saveCurrentState() {
      const form = this.element.querySelector("form")
      if (!form) return
      const FDClass =
         foundry.applications?.ux?.FormDataExtended ?? FormDataExtended
      const formData = new FDClass(form)
      const data = foundry.utils.expandObject(formData.object)

      data.allParts = !!data.allParts

      delete data.specificPartsSelect
      if (!data.specificParts) data.specificParts = []
      if (!Array.isArray(data.specificParts))
         data.specificParts = [data.specificParts]

      delete data.damageTypesSelect
      if (!data.damageTypes) data.damageTypes = []
      if (!Array.isArray(data.damageTypes))
         data.damageTypes = [data.damageTypes]

      data.triggers = normalizeTriggerData(data.triggers, this.actor)

      const index = this.workingReactions.findIndex(
         (r) => r.id === this.reactionId,
      )
      data.id = this.reactionId
      data.disabled = this.workingReactions[index].disabled
      this.workingReactions[index] = data
   }

   static async _onSaveChanges(event, target) {
      await this._saveCurrentState()
      captureActorSheetScroll(this.actor)
      await this.actor.setFlag(MODULE_ID, "reactions", this.workingReactions)
      this.close()
   }

   _saveScrollPos() {
      const form = this.element?.querySelector(".rnt-scrollable")
      if (form) window.RNT_REACTION_SCROLL = form.scrollTop
   }

   _restoreScrollPos() {
      const restore = () => {
         const form = this.element?.querySelector(".rnt-scrollable")
         if (
            form &&
            form.isConnected &&
            window.RNT_REACTION_SCROLL !== undefined
         ) {
            form.scrollTop = window.RNT_REACTION_SCROLL
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

      this.element
         .querySelector('select[name="specificPartsSelect"]')
         ?.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            if (!val) return
            await this._saveCurrentState()
            const rx = this._getReaction()
            if (!rx.specificParts) rx.specificParts = []
            if (!rx.specificParts.includes(val)) {
               rx.specificParts.push(val)
               this._saveScrollPos()
               this.render()
            }
         })

      this.element
         .querySelector('select[name="damageTypesSelect"]')
         ?.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            if (!val) return
            await this._saveCurrentState()
            const rx = this._getReaction()
            if (!rx.damageTypes) rx.damageTypes = []
            if (!rx.damageTypes.includes(val)) {
               rx.damageTypes.push(val)
               this._saveScrollPos()
               this.render()
            }
         })

      this.element
         .querySelectorAll('input[type="checkbox"][name$=".isBasicSave"]')
         .forEach((el) => el.addEventListener("change", reRenderOnChange))

      const reactToSelect = this.element.querySelector('select[name="reactTo"]')
      if (reactToSelect)
         reactToSelect.addEventListener("change", reRenderOnChange)

      const allPartsCheck = this.element.querySelector('input[name="allParts"]')
      if (allPartsCheck)
         allPartsCheck.addEventListener("change", reRenderOnChange)

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

      this.element.querySelectorAll(".rnt-re-json-input").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            const parent = ev.currentTarget.closest(".re-entry, .effect-entry")

            if (!parent) return

            try {
               if (val.trim() === "") throw new Error("Empty")
               JSON.parse(val)
               const invalidInput = parent.querySelector(
                  'input[name$=".invalid"]',
               )
               if (invalidInput) invalidInput.value = "false"
               ev.currentTarget.style.borderColor = "green"
            } catch (e) {
               const invalidInput = parent.querySelector(
                  'input[name$=".invalid"]',
               )
               if (invalidInput) invalidInput.value = "true"
               ev.currentTarget.style.borderColor = "red"
               ui.notifications.warn("Invalid Rule Element JSON.")
            }
            await this._saveCurrentState()
         })
      })

      this.element.querySelectorAll(".rnt-condition-select").forEach((sel) => {
         const toggleValInput = () => {
            const opt = sel.options[sel.selectedIndex]
            const needsVal = opt && opt.dataset.hasValue === "true"

            const row = sel.closest(".rnt-repeat-row, .rnt-save-action-fields")
            const valInput = row?.querySelector(
               'input[type="number"][name$=".value"]',
            )

            if (valInput) {
               valInput.style.display = needsVal ? "" : "none"
               if (!needsVal) valInput.value = 1
            }
         }

         sel.addEventListener("change", (e) => {
            toggleValInput()
            reRenderOnChange()
         })

         toggleValInput()
      })
   }

   static async _onRemoveReactionDmg(event, target) {
      const index = parseInt(target.dataset.index, 10)
      await this._saveCurrentState()
      const rx = this._getReaction()
      if (rx.damageTypes) {
         rx.damageTypes.splice(index, 1)
         this._saveScrollPos()
         this.render()
      }
   }

   static async _onRemoveReactionPart(event, target) {
      const index = parseInt(target.dataset.index, 10)
      await this._saveCurrentState()
      const rx = this._getReaction()
      if (rx.specificParts) {
         rx.specificParts.splice(index, 1)
         this._saveScrollPos()
         this.render()
      }
   }

   static async _onAddTrigger(event, target) {
      await this._saveCurrentState()
      const rx = this._getReaction()
      rx.triggers.push({
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
      this._getReaction().triggers.splice(index, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddTriggerDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this._getReaction().triggers[ti].damages.push(newTriggerDamage())
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveTriggerDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const di = parseInt(target.dataset.di, 10)
      await this._saveCurrentState()
      this._getReaction().triggers[ti].damages.splice(di, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddBasicDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      const trig = this._getReaction().triggers[ti]
      if (!trig.basicDamages) trig.basicDamages = []
      trig.basicDamages.push(newTriggerDamage())
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveBasicDamage(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const bdi = parseInt(target.dataset.bdi, 10)
      await this._saveCurrentState()
      this._getReaction().triggers[ti].basicDamages.splice(bdi, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddSaveAction(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const dos = target.dataset.dos
      await this._saveCurrentState()

      const rx = this._getReaction()
      if (!rx) return
      if (!rx.triggers) rx.triggers = []
      const trig = rx.triggers[ti]
      if (!trig) return
      trig.type = "saving-throw"
      if (!trig.saveActions || Array.isArray(trig.saveActions))
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
      const trig = this._getReaction()?.triggers?.[ti]
      if (!trig?.saveActions?.[dos]) return
      trig.saveActions[dos].splice(sai, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onBuildRuleElement(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const dos = target.dataset.dos
      const sai = parseInt(target.dataset.sai, 10)
      const isTrigger = target.dataset.isTrigger === "true"

      new RuleElementApp({
         actor: this.actor,
         callback: async (jsonString) => {
            await this._saveCurrentState()
            const rx = this._getReaction()
            if (isTrigger) {
               rx.triggers[ti].json = jsonString
               rx.triggers[ti].invalid = false
            } else {
               rx.triggers[ti].saveActions[dos][sai].json = jsonString
               rx.triggers[ti].saveActions[dos][sai].invalid = false
            }
            this._saveScrollPos()
            this.render()
         },
      }).render(true)
   }

   static async _onPickFile(event, target) {
      const input =
         target
            .closest(
               ".rnt-sfx-field, .rnt-field-control, .rnt-sfx-row, .flexrow, .form-fields",
            )
            ?.querySelector("input[type='text']") ||
         target.previousElementSibling
      const FPClass =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      new FPClass({
         type: "audio",
         current: input.value,
         callback: (path) => {
            input.value = path
         },
      }).browse(input.value)
   }

   static async _onPreviewSfx(event, target) {
      const input =
         target
            .closest(
               ".rnt-sfx-field, .rnt-field-control, .rnt-sfx-row, .flexrow, .form-fields",
            )
            ?.querySelector("input[type='text']") ||
         target.previousElementSibling.previousElementSibling
      if (input.value) await playSfx(input.value, "damageReaction", true)
   }
}
