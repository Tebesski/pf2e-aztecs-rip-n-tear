const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { playSfx, sfxTypeForFieldName } from "../sfx.mjs"
import { captureActorSheetScroll } from "../sheet/scroll.mjs"
import {
   isSiegeVehicleActor,
   normalizeRntThresholdTargets,
   RNT_THRESHOLD_TARGET_VEHICLE,
   syncRntDisabledModules,
   withRntActorTheme,
   withRntDialogTheme,
} from "../actor-support.mjs"
import { RuleElementApp } from "./rule-element-app.mjs"
import { SpellcastingConfigApp } from "./spellcasting-config-app.mjs"
import { prepareBodyPartEditorContext } from "./body-part/editor-context.mjs"
import { activateBodyPartEditorRender } from "./body-part/editor-render.mjs"
import { saveBodyPartEditorState } from "./body-part/editor-save.mjs"
import { removeIwrValue } from "./body-part/removal-actions.mjs"
import { renderDialogMessage } from "../dialogs/content.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates`

export { DamageBodyPartApp } from "./body-part/damage-app.mjs"

export class BodyPartApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      options = withRntActorTheme(options)
      super(options)
      this.actor = options.actor
      this.partId = options.partId
      this.workingParts = null
   }

   static DEFAULT_OPTIONS = {
      id: "body-part-editor",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 600, height: 700 },
      window: { title: `${MODULE_ID}.editorTitle` },
      actions: {
         saveChanges: this._onSaveChanges,
         addThreshold: this._onAddThreshold,
         removeThreshold: this._onRemoveThreshold,
         removeThresholdPart: this._onRemoveThresholdPart,
         removeThresholdTarget: this._onRemoveThresholdTarget,
         addCondition: this._onAddCondition,
         removeCondition: this._onRemoveCondition,
         addEffect: this._onAddEffect,
         removeEffect: this._onRemoveEffect,
         addMacro: this._onAddMacro,
         removeMacro: this._onRemoveMacro,
         addScript: this._onAddScript,
         removeScript: this._onRemoveScript,
         addDamage: this._onAddDamage,
         removeDamage: this._onRemoveDamage,
         addRuleElement: this._onAddRuleElement,
         removeRuleElement: this._onRemoveRuleElement,
         removeLinkedItem: this._onRemoveLinkedItem,
         removeLinkedModule: this._onRemoveLinkedModule,
         configSpellcasting: this._onConfigSpellcasting,
         pickFile: this._onPickFile,
         previewSfx: this._onPreviewSfx,
         removeImmunity: this._onRemoveImmunity,
         removeWeakness: this._onRemoveWeakness,
         removeResistance: this._onRemoveResistance,
         removeImmuneExc: this._onRemoveImmuneExc,
         removeWeakExc: this._onRemoveWeakExc,
         removeResistExc: this._onRemoveResistExc,
         removeAcceptedDmgType: this._onRemoveAcceptedDmgType,
         removeDisableRegenDmgType: this._onRemoveDisableRegenDmgType,
         pickPartIcon: this._onPickPartIcon,
      },
   }

   static PARTS = {
      form: { template: `${TEMPLATE_BASE}/body-part-editor.hbs` },
   }

   static async _onPickPartIcon(event, target) {
      const input = target.nextElementSibling
      if (!input) return
      const FPClass =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      const fp = new FPClass({
         type: "image",
         current: input.value,
         callback: async (path) => {
            input.value = path
            target.src = path
            await this._saveCurrentState()
         },
      })
      fp.render(true)
   }

   async _prepareContext(options) {
      return prepareBodyPartEditorContext.call(this, options)
   }

   _saveViewState() {
      if (!this.element) return
      const scrollable = this.element.querySelector(".rnt-scrollable")
      if (scrollable) this._savedScrollPos = scrollable.scrollTop

      this._accordionStates = new Map()
      this.element.querySelectorAll("details").forEach((d) => {
         let key = d.dataset.section
         if (!key && d.dataset.threshold !== undefined)
            key = `threshold-${d.dataset.threshold}`
         if (key) this._accordionStates.set(key, d.hasAttribute("open"))
      })
   }

   _onRender(context, options) {
      super._onRender(context, options)
      activateBodyPartEditorRender.call(this, context, options)
   }

   _getParts() {
      return this.workingParts
   }

   async _saveCurrentState() {
      return saveBodyPartEditorState.call(this)
   }

   static async _onSaveChanges(event, target) {
      await this._saveCurrentState()
      captureActorSheetScroll(this.actor)
      await this.actor.setFlag(MODULE_ID, "parts", this.workingParts)
      await syncRntDisabledModules(this.actor, this.workingParts)
      this.close()
   }

   static async _onPickFile(event, target) {
      const input = target
         .closest(
            ".rnt-sfx-field, .rnt-field-control, .form-fields, .rnt-sfx-row",
         )
         ?.querySelector("input[type='text']")
      if (!input) return
      const FPClass =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      const fp = new FPClass({
         type: "audio",
         current: input.value,
         callback: async (path) => {
            input.value = path
            await this._saveCurrentState()
         },
      })
      fp.render(true)
   }

   static async _onPreviewSfx(event, target) {
      const input = target
         .closest(
            ".rnt-sfx-field, .rnt-field-control, .form-fields, .rnt-sfx-row",
         )
         ?.querySelector("input[type='text']")
      if (!input) return
      const path = input.value
      if (!path) return
      const sfxType = sfxTypeForFieldName(input.name)
      await playSfx(path, sfxType, false)
   }

   async _confirmRemoval(itemNameKey) {
      const itemName = game.i18n.localize(`${MODULE_ID}.${itemNameKey}`)
      return await foundry.applications.api.DialogV2.confirm(
         withRntDialogTheme(
            {
               window: {
                  title: game.i18n.format(`${MODULE_ID}.removeItemTitle`, {
                     itemName,
                  }),
               },
               content: await renderDialogMessage(
                  game.i18n.format(`${MODULE_ID}.removeItemPrompt`, {
                     itemName: itemName.toLowerCase(),
                  }),
               ),
               rejectClose: false,
            },
            this.actor,
         ),
      )
   }

   static async _onRemoveImmunity(event, target) {
      await removeIwrValue(this, "immunity", "immune", target.dataset.raw)
   }

   static async _onRemoveWeakness(event, target) {
      await removeIwrValue(this, "weakness", "weak", target.dataset.raw)
   }

   static async _onRemoveResistance(event, target) {
      await removeIwrValue(this, "resistance", "resist", target.dataset.raw)
   }

   static async _onRemoveImmuneExc(event, target) {
      await removeIwrValue(
         this,
         "immunityException",
         "immuneExc",
         target.dataset.raw,
      )
   }

   static async _onRemoveWeakExc(event, target) {
      await removeIwrValue(
         this,
         "weaknessException",
         "weakExc",
         target.dataset.raw,
      )
   }

   static async _onRemoveResistExc(event, target) {
      await removeIwrValue(
         this,
         "resistanceException",
         "resistExc",
         target.dataset.raw,
      )
   }

   static async _onRemoveAcceptedDmgType(event, target) {
      if (!(await this._confirmRemoval("acceptedDamageType"))) return
      const slug = target.dataset.slug
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      if (!part.acceptedDmgTypes) part.acceptedDmgTypes = []
      part.acceptedDmgTypes = part.acceptedDmgTypes.filter((t) => t !== slug)
      this._saveViewState()
      this.render()
   }

   static async _onRemoveDisableRegenDmgType(event, target) {
      const slug = target.dataset.slug
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      if (!part.disableRegenDmgTypes) part.disableRegenDmgTypes = []
      part.disableRegenDmgTypes = part.disableRegenDmgTypes.filter(
         (t) => t !== slug,
      )
      this._saveViewState()
      this.render()
   }

   static async _onRemoveLinkedItem(event, target) {
      if (!(await this._confirmRemoval("linkedAbility"))) return
      const id = target.dataset.id
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      part.linkedItems = part.linkedItems.filter((i) => i !== id)
      part.linkedEntries = part.linkedEntries.filter((i) => i !== id)
      part.linkedSpells = part.linkedSpells.filter((i) => i !== id)
      this._saveViewState()
      this.render()
   }

   static async _onRemoveLinkedModule(event, target) {
      if (!(await this._confirmRemoval("linkedModule"))) return
      const id = target.dataset.id
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      part.linkedModules = (part.linkedModules || []).filter((i) => i !== id)
      this._saveViewState()
      this.render()
   }

   static async _onConfigSpellcasting(event, target) {
      if (isSiegeVehicleActor(this.actor)) return
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)

      new SpellcastingConfigApp({
         actor: this.actor,
         partId: this.partId,
         linkedEntries: part.linkedEntries || [],
         linkedSpells: part.linkedSpells || [],
         callback: async (entries, spells) => {
            await this._saveCurrentState()
            const p = this.workingParts.find((x) => x.id === this.partId)
            p.linkedEntries = entries
            p.linkedSpells = spells
            this._saveViewState()
            this.render()
         },
      }).render(true)
   }

   static async _onAddThreshold(event, target) {
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds.push({
            hpValue: 0,
            disableAbilities: false,
            disableModules: false,
            modifyVehicleLoadCapacity: false,
            vehicleLoadCapacityModifier: 0,
            modifyVehicleSpeed: false,
            vehicleSpeedModifier: 0,
            linkedParts: [],
            conditions: [],
            effects: [],
            macros: [],
            damages: [],
            ruleElements: [],
         })
      this._saveViewState()
      this.render()
   }

   static async _onRemoveThreshold(event, target) {
      if (!(await this._confirmRemoval("damageThreshold"))) return
      const index = parseInt(target.dataset.index, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds.splice(index, 1)
      this._saveViewState()
      this.render()
   }

   static async _onAddCondition(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].conditions.push({
            slug: "off-guard",
            value: 1,
            targets: [RNT_THRESHOLD_TARGET_VEHICLE],
         })
      this._saveViewState()
      this.render()
   }

   static async _onRemoveThresholdPart(event, target) {
      if (!(await this._confirmRemoval("linkedBodyPart"))) return
      const ti = parseInt(target.dataset.ti, 10)
      const lpi = parseInt(target.dataset.lpi, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[ti].linkedParts.splice(lpi, 1)
      this._saveViewState()
      this.render()
   }

   static async _onRemoveThresholdTarget(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const kind = target.dataset.kind
      const entryIndex = parseInt(target.dataset.entryIndex, 10)
      const targetIndex = parseInt(target.dataset.targetIndex, 10)
      if (
         !kind ||
         !Number.isInteger(ti) ||
         !Number.isInteger(entryIndex) ||
         !Number.isInteger(targetIndex)
      )
         return

      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      const entry = part?.thresholds?.[ti]?.[kind]?.[entryIndex]
      if (!entry) return

      entry.targets = normalizeRntThresholdTargets(entry.targets)
      entry.targets.splice(targetIndex, 1)
      if (!entry.targets.length) entry.targets.push(RNT_THRESHOLD_TARGET_VEHICLE)

      this._saveViewState()
      this.render()
   }

   static async _onRemoveCondition(event, target) {
      if (!(await this._confirmRemoval("condition"))) return
      const tIndex = parseInt(target.dataset.ti, 10)
      const cIndex = parseInt(target.dataset.ci, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].conditions.splice(cIndex, 1)
      this._saveViewState()
      this.render()
   }

   static async _onAddEffect(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].effects.push({
            uuid: "",
            name: game.i18n.localize("pf2e-aztecs-rip-n-tear.pending"),
            img: "icons/svg/mystery-man.svg",
            invalid: false,
            targets: [RNT_THRESHOLD_TARGET_VEHICLE],
         })
      this._saveViewState()
      this.render()
   }

   static async _onRemoveEffect(event, target) {
      if (!(await this._confirmRemoval("effect"))) return
      const tIndex = parseInt(target.dataset.ti, 10)
      const eIndex = parseInt(target.dataset.ei, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].effects.splice(eIndex, 1)
      this._saveViewState()
      this.render()
   }

   static async _onAddMacro(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].macros.push({
            uuid: "",
            name: game.i18n.localize("pf2e-aztecs-rip-n-tear.pending"),
            img: "icons/svg/dice-target.svg",
            invalid: false,
         })
      this._saveViewState()
      this.render()
   }

   static async _onRemoveMacro(event, target) {
      if (!(await this._confirmRemoval("macro"))) return
      const tIndex = parseInt(target.dataset.ti, 10)
      const mIndex = parseInt(target.dataset.mi, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].macros.splice(mIndex, 1)
      this._saveViewState()
      this.render()
   }

   static async _onAddScript(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].scripts.push({ code: "" })
      this._saveViewState()
      this.render()
   }

   static async _onRemoveScript(event, target) {
      if (!(await this._confirmRemoval("script"))) return
      const tIndex = parseInt(target.dataset.ti, 10)
      const sIndex = parseInt(target.dataset.si, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].scripts.splice(sIndex, 1)
      this._saveViewState()
      this.render()
   }

   static async _onAddDamage(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].damages.push({
            diceNum: 1,
            diceStep: "6",
            dmgType: "slashing",
            dmgCategory: "",
            targets: [RNT_THRESHOLD_TARGET_VEHICLE],
         })
      this._saveViewState()
      this.render()
   }

   static async _onRemoveDamage(event, target) {
      if (!(await this._confirmRemoval("damageInstance"))) return
      const tIndex = parseInt(target.dataset.ti, 10)
      const dIndex = parseInt(target.dataset.di, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].damages.splice(dIndex, 1)
      this._saveViewState()
      this.render()
   }

   static async _onAddRuleElement(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      new RuleElementApp({
         actor: this.actor,
         partId: this.partId,
         tIndex,
         callback: async (jsonString) => {
            await this._saveCurrentState()
            this.workingParts
               .find((p) => p.id === this.partId)
               .thresholds[tIndex].ruleElements.push({
                  json: jsonString,
                  invalid: false,
                  targets: [RNT_THRESHOLD_TARGET_VEHICLE],
               })
            this._saveViewState()
            this.render()
         },
      }).render(true)
   }

   static async _onRemoveRuleElement(event, target) {
      if (!(await this._confirmRemoval("ruleElement"))) return
      const tIndex = parseInt(target.dataset.ti, 10)
      const rei = parseInt(target.dataset.rei, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].ruleElements.splice(rei, 1)
      this._saveViewState()
      this.render()
   }
}
