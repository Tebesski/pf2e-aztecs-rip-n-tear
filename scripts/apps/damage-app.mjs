const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api
import { RuleElementApp } from "./rule-element-app.mjs"
import { applyBodyPartDamage, resolveSfxPath } from "../mechanics.mjs"
import { SpellcastingConfigApp } from "./spellcasting-config-app.mjs"

export class DamageBodyPartApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.partId = options.partId
      this.damages =
         options.initialDamages && options.initialDamages.length
            ? options.initialDamages
            : [{ amount: 1, dmgType: "slashing", dmgCategory: "" }]
   }

   static DEFAULT_OPTIONS = {
      id: "damage-body-part-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 450, height: "auto" },
      window: { title: "pf2e-aztecs-rip-n-tear.damageBodyPart" },
      actions: {
         addDamage: this._onAddDamage,
         removeDamage: this._onRemoveDamage,
         applyDamage: this._onApplyDamage,
      },
   }

   static PARTS = {
      form: {
         template: "modules/pf2e-aztecs-rip-n-tear/templates/damage-app.hbs",
      },
   }

   async _prepareContext(options) {
      const parts = this.actor.getFlag("pf2e-aztecs-rip-n-tear", "parts") || []
      const part = parts.find((p) => p.id === this.partId) || {}

      const iwrImmune =
         part.customIWR && part.iwr?.immune
            ? part.iwr.immune
            : this.actor.system.attributes.immunities
                 ?.map((x) => x.type)
                 .join(", ") ||
              game.i18n.localize("pf2e-aztecs-rip-n-tear.none")
      const iwrWeak =
         part.customIWR && part.iwr?.weak
            ? part.iwr.weak
            : this.actor.system.attributes.weaknesses
                 ?.map((x) => `${x.type} ${x.value}`)
                 .join(", ") ||
              game.i18n.localize("pf2e-aztecs-rip-n-tear.none")
      const iwrResist =
         part.customIWR && part.iwr?.resist
            ? part.iwr.resist
            : this.actor.system.attributes.resistances
                 ?.map((x) => `${x.type} ${x.value}`)
                 .join(", ") ||
              game.i18n.localize("pf2e-aztecs-rip-n-tear.none")

      const baseDamageTypes = {
         acid: "Acid",
         bludgeoning: "Bludgeoning",
         cold: "Cold",
         electricity: "Electricity",
         fire: "Fire",
         force: "Force",
         mental: "Mental",
         piercing: "Piercing",
         poison: "Poison",
         slashing: "Slashing",
         bleed: "Bleed",
         sonic: "Sonic",
         vitality: "Vitality",
         void: "Void",
      }
      const rawTypes =
         CONFIG.PF2E?.damageTypes ||
         CONFIG.PF2E?.damageTraits ||
         baseDamageTypes
      const pf2eDamageTypes = Object.entries(rawTypes)
         .map(([slug, label]) => ({
            slug,
            label: typeof label === "string" ? game.i18n.localize(label) : slug,
         }))
         .sort((a, b) => a.label.localeCompare(b.label))

      return {
         part,
         iwrImmune,
         iwrWeak,
         iwrResist,
         damages: this.damages,
         pf2eDamageTypes,
      }
   }

   _saveScrollPos() {
      const scrollable = this.element?.querySelector(".rnt-scrollable")
      if (scrollable) this._savedScrollPos = scrollable.scrollTop
   }

   _onRender(context, options) {
      super._onRender(context, options)
      if (this._savedScrollPos !== undefined) {
         const scrollable = this.element.querySelector(".rnt-scrollable")
         if (scrollable) scrollable.scrollTop = this._savedScrollPos
      }
   }

   static async _onAddDamage(event, target) {
      this.damages.push({ amount: 1, dmgType: "slashing", dmgCategory: "" })
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveDamage(event, target) {
      const index = parseInt(target.dataset.index, 10)
      this.damages.splice(index, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onApplyDamage(event, target) {
      const form = this.element.querySelector("form")
      const formData = new FormDataExtended(form)
      const data = foundry.utils.expandObject(formData.object)

      const ignoreHardness = parseInt(data.ignoreHardness) || 0
      const ignoreAllHardness = data.ignoreAllHardness === true
      const damagesToApply = data.damages ? Object.values(data.damages) : []

      for (const d of damagesToApply) {
         let amt = d.amount
         if (d.dmgCategory !== "persistent") {
            if (typeof amt === "string" && amt.includes("d")) {
               const roll = await new Roll(amt).evaluate()
               amt = roll.total
            } else {
               amt = parseInt(amt) || 0
            }
         }
         await applyBodyPartDamage(
            this.actor,
            this.partId,
            amt,
            d.dmgType,
            d.dmgCategory,
            ignoreHardness,
            ignoreAllHardness,
         )
      }
      this.close()
   }
}

export class BodyPartApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.partId = options.partId
   }

   static DEFAULT_OPTIONS = {
      id: "body-part-editor",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 550, height: 700 },
      window: { title: "pf2e-aztecs-rip-n-tear.editorTitle" },
      actions: {
         saveChanges: this._onSaveChanges,
         addThreshold: this._onAddThreshold,
         removeThreshold: this._onRemoveThreshold,
         addCondition: this._onAddCondition,
         removeCondition: this._onRemoveCondition,
         addEffect: this._onAddEffect,
         removeEffect: this._onRemoveEffect,
         addDamage: this._onAddDamage,
         removeDamage: this._onRemoveDamage,
         addRuleElement: this._onAddRuleElement,
         removeRuleElement: this._onRemoveRuleElement,
         removeLinkedItem: this._onRemoveLinkedItem,
         configSpellcasting: this._onConfigSpellcasting,
         pickFile: this._onPickFile,
         previewSfx: this._onPreviewSfx,
      },
   }

   static PARTS = {
      form: {
         template:
            "modules/pf2e-aztecs-rip-n-tear/templates/body-part-editor.hbs",
      },
   }

   async _prepareContext(options) {
      const parts = this.actor.getFlag("pf2e-aztecs-rip-n-tear", "parts") || []
      const part = foundry.utils.deepClone(
         parts.find((p) => p.id === this.partId) || {},
      )
      part.linkedItems = part.linkedItems || []
      part.linkedEntries = part.linkedEntries || []
      part.linkedSpells = part.linkedSpells || []
      part.thresholds = part.thresholds || []

      const actorImmune =
         this.actor.system.attributes.immunities
            ?.map((x) => x.type)
            .join(", ") || ""
      const actorWeak =
         this.actor.system.attributes.weaknesses
            ?.map((x) => `${x.type} ${x.value}`)
            .join(", ") || ""
      const actorResist =
         this.actor.system.attributes.resistances
            ?.map((x) => `${x.type} ${x.value}`)
            .join(", ") || ""
      part.iwr = part.iwr || {
         immune: actorImmune,
         weak: actorWeak,
         resist: actorResist,
      }

      const conditionSlugs = [
         "blinded",
         "broken",
         "clumsy",
         "concealed",
         "confused",
         "controlled",
         "dazzled",
         "deafened",
         "doomed",
         "drained",
         "dying",
         "encumbered",
         "enfeebled",
         "fasculated",
         "fatigued",
         "fleeing",
         "frightened",
         "grabbed",
         "hidden",
         "immobilized",
         "invisible",
         "observed",
         "off-guard",
         "paralyzed",
         "persistent-damage",
         "petrified",
         "prone",
         "quickened",
         "restrained",
         "ruined",
         "sickened",
         "slowed",
         "stunned",
         "stupefied",
         "unconscious",
         "undetected",
         "wounded",
      ]
      const valuedConditions = [
         "clumsy",
         "doomed",
         "drained",
         "enfeebled",
         "frightened",
         "sickened",
         "slowed",
         "stunned",
         "stupefied",
      ]

      const pf2eConditions = conditionSlugs.map((slug) => ({
         slug: slug,
         name: slug.charAt(0).toUpperCase() + slug.slice(1).replace("-", " "),
         hasValue: valuedConditions.includes(slug),
      }))

      const baseDamageTypes = {
         acid: "Acid",
         bludgeoning: "Bludgeoning",
         cold: "Cold",
         electricity: "Electricity",
         fire: "Fire",
         force: "Force",
         mental: "Mental",
         piercing: "Piercing",
         poison: "Poison",
         slashing: "Slashing",
         bleed: "Bleed",
         sonic: "Sonic",
         vitality: "Vitality",
         void: "Void",
      }
      const rawTypes =
         CONFIG.PF2E?.damageTypes ||
         CONFIG.PF2E?.damageTraits ||
         baseDamageTypes
      const pf2eDamageTypes = Object.entries(rawTypes)
         .map(([slug, label]) => ({
            slug,
            label: typeof label === "string" ? game.i18n.localize(label) : slug,
         }))
         .sort((a, b) => a.label.localeCompare(b.label))

      part.thresholds.forEach((t) => {
         t.conditions = t.conditions || []
         t.effects = t.effects || []
         t.damages = t.damages || []
         t.ruleElements = t.ruleElements || []
         t.conditions.forEach(
            (c) => (c.hasValue = valuedConditions.includes(c.slug)),
         )
      })

      const allItems = this.actor.items
      const linkedItemsData = part.linkedItems.map((id) => {
         if (id === "ALL_SPELLCASTING") {
            return { id, name: "Spellcasting" }
         }
         const item = allItems.get(id)
         return {
            id: id,
            name: item
               ? item.name
               : game.i18n.localize("pf2e-aztecs-rip-n-tear.unknownItem"),
         }
      })

      const unlinkedItems = allItems.filter(
         (i) => !part.linkedItems.includes(i.id),
      )
      const attacks = unlinkedItems.filter(
         (i) => i.type === "melee" || i.type === "weapon",
      )
      const abilities = unlinkedItems.filter(
         (i) => i.type === "action" && i.system.actionType?.value === "action",
      )
      const passives = unlinkedItems.filter(
         (i) => i.type === "action" && i.system.actionType?.value === "passive",
      )

      return {
         part,
         linkedItemsData,
         attacks,
         abilities,
         passives,
         pf2eConditions,
         pf2eDamageTypes,
      }
   }

   _saveScrollPos() {
      const scrollable = this.element?.querySelector(".rnt-scrollable")
      if (scrollable) this._savedScrollPos = scrollable.scrollTop
   }

   _onRender(context, options) {
      super._onRender(context, options)

      if (this._savedScrollPos !== undefined) {
         const scrollable = this.element.querySelector(".rnt-scrollable")
         if (scrollable) scrollable.scrollTop = this._savedScrollPos
      }

      this.element.querySelectorAll(".item-link").forEach((el) => {
         el.addEventListener("click", async (ev) => {
            const id = ev.currentTarget.dataset.id
            const item = this.actor.items.get(id)
            if (item) item.sheet.render(true)
         })
      })

      this.element.querySelectorAll(".rnt-effect-link").forEach((el) => {
         el.addEventListener("click", async (ev) => {
            const uuid = ev.currentTarget.dataset.uuid
            const item = await fromUuid(uuid)
            if (item) item.sheet.render(true)
         })
      })

      const abilitySelect = this.element.querySelector(".rnt-ability-select")
      if (abilitySelect) {
         abilitySelect.addEventListener("change", async (ev) => {
            const id = ev.currentTarget.value
            if (!id) return
            await this._saveCurrentState()
            const parts = this._getParts()
            const part = parts.find((p) => p.id === this.partId)
            part.linkedItems = part.linkedItems || []
            if (!part.linkedItems.includes(id)) part.linkedItems.push(id)
            await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
            this._saveScrollPos()
            this.render()
         })
      }

      this.element.querySelectorAll(".rnt-condition-select").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            const slug = ev.currentTarget.value
            const parent = ev.currentTarget.closest(".flexrow")
            parent.querySelector(".condition-icon").src =
               `systems/pf2e/icons/conditions/${slug}.webp`
            await this._saveCurrentState()
         })
      })

      this.element.querySelectorAll(".rnt-effect-uuid-input").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            const uuid = ev.currentTarget.value
            const parent = ev.currentTarget.closest(".effect-entry")
            const iconEl = parent.querySelector(".effect-icon")
            const nameEl = parent.querySelector(".effect-name-container")

            if (!uuid) {
               iconEl.src = "icons/svg/mystery-man.svg"
               nameEl.innerHTML = `<span style="color: gray;">Pending...</span>`
               parent.querySelector('input[name$=".invalid"]').value = "false"
               await this._saveCurrentState()
               return
            }

            const item = await fromUuid(uuid)
            if (!item || item.type !== "effect") {
               iconEl.src = "icons/svg/hazard.svg"
               nameEl.innerHTML = `<span style="color: darkred; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> ${game.i18n.localize("pf2e-aztecs-rip-n-tear.invalidEffect")}</span>`
               parent.querySelector('input[name$=".invalid"]').value = "true"
               parent.querySelector('input[name$=".name"]').value =
                  "Invalid Effect"
               parent.querySelector('input[name$=".img"]').value =
                  "icons/svg/hazard.svg"
            } else {
               iconEl.src = item.img
               nameEl.innerHTML = `<a class="content-link rnt-effect-link" data-uuid="${uuid}"><i class="fa-solid fa-suitcase"></i> ${item.name}</a>`
               parent.querySelector('input[name$=".invalid"]').value = "false"
               parent.querySelector('input[name$=".name"]').value = item.name
               parent.querySelector('input[name$=".img"]').value = item.img
            }
            await this._saveCurrentState()
         })
      })

      this.element
         .querySelectorAll('select[name$=".dmgType"]')
         .forEach((el) => {
            el.addEventListener("change", async (ev) => {
               const val = ev.currentTarget.value
               if (val === "bleed") {
                  const row = ev.currentTarget.closest(".flexrow")
                  const catSelect = row.querySelector(
                     'select[name$=".dmgCategory"]',
                  )
                  if (catSelect) catSelect.value = "persistent"
               }
               await this._saveCurrentState()
            })
         })

      this.element.querySelectorAll(".rnt-re-json-input").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            const parent = ev.currentTarget.closest(".re-entry")
            try {
               if (val.trim() === "") throw new Error("Empty")
               JSON.parse(val)
               parent.querySelector('input[name$=".invalid"]').value = "false"
               ev.currentTarget.style.borderColor = "green"
            } catch (e) {
               parent.querySelector('input[name$=".invalid"]').value = "true"
               ev.currentTarget.style.borderColor = "red"
               ui.notifications.warn(
                  game.i18n.localize("pf2e-aztecs-rip-n-tear.invalidJson"),
               )
            }
            await this._saveCurrentState()
         })
      })

      const customIWR = this.element.querySelector('input[name="customIWR"]')
      if (customIWR) {
         customIWR.addEventListener("change", async () => {
            await this._saveCurrentState()
            this._saveScrollPos()
            this.render()
         })
      }
   }

   _getParts() {
      return foundry.utils.deepClone(
         this.actor.getFlag("pf2e-aztecs-rip-n-tear", "parts") || [],
      )
   }

   async _saveCurrentState() {
      const form = this.element.querySelector("form")
      if (!form) return
      const formData = new FormDataExtended(form)
      const updatedPart = foundry.utils.expandObject(formData.object)

      const parts = this._getParts()
      const index = parts.findIndex((p) => p.id === this.partId)
      const currentPart = parts[index] || {}

      updatedPart.id = this.partId
      updatedPart.linkedItems = currentPart.linkedItems || []
      updatedPart.linkedEntries = currentPart.linkedEntries || []
      updatedPart.linkedSpells = currentPart.linkedSpells || []

      if (updatedPart.thresholds) {
         updatedPart.thresholds = Object.values(updatedPart.thresholds).map(
            (t) => {
               t.conditions = t.conditions ? Object.values(t.conditions) : []
               t.effects = t.effects
                  ? Object.values(t.effects).map((e) => ({
                       ...e,
                       invalid: String(e.invalid) === "true",
                    }))
                  : []
               t.damages = t.damages ? Object.values(t.damages) : []
               t.ruleElements = t.ruleElements
                  ? Object.values(t.ruleElements).map((r) => ({
                       ...r,
                       invalid: String(r.invalid) === "true",
                    }))
                  : []
               return t
            },
         )
      } else {
         updatedPart.thresholds = currentPart.thresholds || []
      }

      if (index !== -1)
         parts[index] = foundry.utils.mergeObject(currentPart, updatedPart)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
   }

   static async _onSaveChanges(event, target) {
      await this._saveCurrentState()
      this.close()
   }

   static async _onPickFile(event, target) {
      const input = target.closest(".form-fields").querySelector("input")
      const fp = new FilePicker({
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
      const input = target.closest(".form-fields").querySelector("input")
      const path = input.value
      if (!path) return
      const resolvedPath = await resolveSfxPath(path)
      if (resolvedPath) {
         AudioHelper.play({ src: resolvedPath, volume: 0.8 }, false)
      } else {
         ui.notifications.warn(
            "No audio files found matching that path or wildcard.",
         )
      }
   }

   static async _onRemoveLinkedItem(event, target) {
      const id = target.dataset.id
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      part.linkedItems = part.linkedItems.filter((i) => i !== id)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onConfigSpellcasting(event, target) {
      await this._saveCurrentState()
      new SpellcastingConfigApp({
         actor: this.actor,
         partId: this.partId,
      }).render(true)
   }

   static async _onAddThreshold(event, target) {
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds.push({
            hpValue: 0,
            disableAbilities: false,
            conditions: [],
            effects: [],
            damages: [],
            ruleElements: [],
         })
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveThreshold(event, target) {
      const index = parseInt(target.dataset.index, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts.find((p) => p.id === this.partId).thresholds.splice(index, 1)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddCondition(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].conditions.push({ slug: "off-guard", value: 1 })
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveCondition(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const cIndex = parseInt(target.dataset.ci, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].conditions.splice(cIndex, 1)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddEffect(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[
            tIndex
         ].effects.push({ uuid: "", name: "Pending...", img: "icons/svg/mystery-man.svg", invalid: false })
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveEffect(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const eIndex = parseInt(target.dataset.ei, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].effects.splice(eIndex, 1)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddDamage(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[
            tIndex
         ].damages.push({ diceNum: 1, diceStep: "6", dmgType: "slashing", dmgCategory: "" })
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveDamage(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const dIndex = parseInt(target.dataset.di, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].damages.splice(dIndex, 1)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddRuleElement(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      new RuleElementApp({
         actor: this.actor,
         partId: this.partId,
         tIndex: tIndex,
         callback: async (jsonString) => {
            await this._saveCurrentState()
            const parts = this._getParts()
            parts
               .find((p) => p.id === this.partId)
               .thresholds[
                  tIndex
               ].ruleElements.push({ json: jsonString, invalid: false })
            await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
            this._saveScrollPos()
            this.render()
         },
      }).render(true)
   }

   static async _onRemoveRuleElement(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const rei = parseInt(target.dataset.rei, 10)
      await this._saveCurrentState()
      const parts = this._getParts()
      parts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].ruleElements.splice(rei, 1)
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }
}
