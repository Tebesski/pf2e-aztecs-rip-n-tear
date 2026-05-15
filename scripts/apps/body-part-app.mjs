const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import {
   MODULE_ID,
   buildPf2eConditions,
   buildPf2eDamageTypes,
   buildPf2eIwrTypes,
   PF2E_VALUED_CONDITIONS,
} from "../constants.mjs"
import { applyBodyPartDamage } from "../mechanics.mjs"
import { playSfx, sfxTypeForFieldName } from "../sfx.mjs"
import { captureActorSheetScroll } from "../sheet-injector.mjs"
import { RuleElementApp } from "./rule-element-app.mjs"
import { SpellcastingConfigApp } from "./spellcasting-config-app.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates`

function formatIwrStr(str) {
   if (!str) return ""
   return str
      .split(",")
      .map((s) => {
         return s
            .trim()
            .split(" ")
            .map((part) => {
               if (!part) return ""
               return part
                  .split("-")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ")
            })
            .join(" ")
      })
      .join(", ")
}

function getActorIwrFallback(actor) {
   const mapSys = (list) => {
      if (!list) return { main: "", exc: "" }
      const ms = [],
         es = []
      for (const x of list) {
         ms.push(x.type + (x.value ? ` ${x.value}` : ""))
         if (x.exceptions) es.push(...x.exceptions)
      }
      return { main: ms.join(", "), exc: es.join(", ") }
   }

   const imm = mapSys(actor.system.attributes.immunities)
   const wk = mapSys(actor.system.attributes.weaknesses)
   const res = mapSys(actor.system.attributes.resistances)

   return {
      immune: imm.main,
      immuneExc: imm.exc,
      weak: wk.main,
      weakExc: wk.exc,
      resist: res.main,
      resistExc: res.exc,
   }
}

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
      this.rollOptions = new Set(options.rollOptions || [])
   }

   static DEFAULT_OPTIONS = {
      id: "damage-body-part-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 450, height: "auto" },
      window: { title: `${MODULE_ID}.damageBodyPart` },
      actions: {
         addDamage: this._onAddDamage,
         removeDamage: this._onRemoveDamage,
         applyDamage: this._onApplyDamage,
      },
   }

   static PARTS = {
      form: { template: `${TEMPLATE_BASE}/damage-app.hbs` },
   }

   async _prepareContext(options) {
      const parts = this.actor.getFlag(MODULE_ID, "parts") || []
      const part = parts.find((p) => p.id === this.partId) || {}

      if (part) {
         const baseFort = this.actor.saves?.fortitude?.mod || 0
         const baseRef = this.actor.saves?.reflex?.mod || 0
         const baseWill = this.actor.saves?.will?.mod || 0

         if (!part.saves) {
            part.saves = {
               fortitude: { enabled: false, value: baseFort + 2 },
               reflex: { enabled: false, value: baseRef + 2 },
               will: { enabled: false, value: baseWill + 2 },
            }
         }
      }

      const fallback = getActorIwrFallback(this.actor)
      const noneText = game.i18n.localize(`${MODULE_ID}.none`)

      const rawImmune =
         part.customIWR && part.iwr?.immune ? part.iwr.immune : fallback.immune
      const rawWeak =
         part.customIWR && part.iwr?.weak ? part.iwr.weak : fallback.weak
      const rawResist =
         part.customIWR && part.iwr?.resist ? part.iwr.resist : fallback.resist

      const rawImmuneExc =
         part.customIWR && part.iwr?.immuneExc
            ? part.iwr.immuneExc
            : fallback.immuneExc
      const rawWeakExc =
         part.customIWR && part.iwr?.weakExc
            ? part.iwr.weakExc
            : fallback.weakExc
      const rawResistExc =
         part.customIWR && part.iwr?.resistExc
            ? part.iwr.resistExc
            : fallback.resistExc

      const iwrImmune = formatIwrStr(rawImmune) || noneText
      const iwrWeak = formatIwrStr(rawWeak) || noneText
      const iwrResist = formatIwrStr(rawResist) || noneText

      const iwrImmuneExc = formatIwrStr(rawImmuneExc)
      const iwrWeakExc = formatIwrStr(rawWeakExc)
      const iwrResistExc = formatIwrStr(rawResistExc)

      return {
         part,
         iwrImmune,
         iwrImmuneExc,
         iwrWeak,
         iwrWeakExc,
         iwrResist,
         iwrResistExc,
         damages: this.damages,
         pf2eDamageTypes: buildPf2eDamageTypes(),
      }
   }

   _onRender(context, options) {
      super._onRender(context, options)

      const html = this.element
      const acInputs = html.querySelectorAll(".rnt-ac-adj-input")

      acInputs.forEach((input) => {
         const display = input.nextElementSibling
         if (!display || !display.classList.contains("rnt-ac-total-display"))
            return

         const baseAc = Number(input.dataset.baseAc) || 0
         const oldAc =
            input.dataset.oldAc !== "" ? Number(input.dataset.oldAc) : NaN

         if (input.value === "" && !isNaN(oldAc)) {
            input.value = oldAc - baseAc
         }

         const updateDisplay = () => {
            const adj = Number(input.value) || 0
            display.textContent = ` = ${baseAc + adj} AC`
         }

         input.addEventListener("input", updateDisplay)
         updateDisplay()
      })
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
      const FDClass =
         foundry.applications?.ux?.FormDataExtended ?? FormDataExtended
      const formData = new FDClass(form)
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
            this.rollOptions,
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
      this.workingParts = null
   }

   static DEFAULT_OPTIONS = {
      id: "body-part-editor",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 550, height: 700 },
      window: { title: `${MODULE_ID}.editorTitle` },
      actions: {
         saveChanges: this._onSaveChanges,
         addThreshold: this._onAddThreshold,
         removeThreshold: this._onRemoveThreshold,
         removeThresholdPart: this._onRemoveThresholdPart,
         addCondition: this._onAddCondition,
         removeCondition: this._onRemoveCondition,
         addEffect: this._onAddEffect,
         removeEffect: this._onRemoveEffect,
         addMacro: this._onAddMacro,
         removeMacro: this._onRemoveMacro,
         addDamage: this._onAddDamage,
         removeDamage: this._onRemoveDamage,
         addRuleElement: this._onAddRuleElement,
         removeRuleElement: this._onRemoveRuleElement,
         removeLinkedItem: this._onRemoveLinkedItem,
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
      },
   }

   static PARTS = {
      form: { template: `${TEMPLATE_BASE}/body-part-editor.hbs` },
   }

   async _prepareContext(options) {
      if (!this.workingParts) {
         this.workingParts = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "parts") || [],
         )
      }

      const part = foundry.utils.deepClone(
         this.workingParts.find((p) => p.id === this.partId) || {},
      )
      part.linkedItems = part.linkedItems || []
      part.linkedEntries = part.linkedEntries || []
      part.linkedSpells = part.linkedSpells || []
      part.thresholds = part.thresholds || []

      const fallback = getActorIwrFallback(this.actor)
      part.iwr = part.iwr || {
         ...fallback,
         immuneExc: "",
         weakExc: "",
         resistExc: "",
      }

      const baseFort = this.actor.saves?.fortitude?.mod || 0
      const baseRef = this.actor.saves?.reflex?.mod || 0
      const baseWill = this.actor.saves?.will?.mod || 0

      if (!part.saves) {
         part.saves = {
            fortitude: { enabled: false, adjustment: 0 },
            reflex: { enabled: false, adjustment: 0 },
            will: { enabled: false, adjustment: 0 },
         }
      } else {
         for (const k of ["fortitude", "reflex", "will"]) {
            part.saves[k] = part.saves[k] || { enabled: false, adjustment: 0 }

            if (
               part.saves[k].adjustment === undefined &&
               part.saves[k].value !== undefined
            ) {
               const base =
                  k === "fortitude"
                     ? baseFort
                     : k === "reflex"
                       ? baseRef
                       : baseWill
               part.saves[k].adjustment = part.saves[k].value - base
            }
            part.saves[k].adjustment = part.saves[k].adjustment || 0
         }
      }

      const pf2eConditions = buildPf2eConditions()
      const pf2eIWRTypes = buildPf2eIwrTypes()
      const pf2eDamageTypes = buildPf2eDamageTypes()

      if (!pf2eIWRTypes.find((t) => t.slug === "all-damage")) {
         pf2eIWRTypes.unshift({
            slug: "all-damage",
            label:
               game.i18n.localize("pf2e-aztecs-rip-n-tear.allDamage") ||
               "All Damage",
         })
      }

      const parseIWR = (str) => {
         if (!str) return []
         return str
            .split(",")
            .map((s) => {
               let exceptions = []
               let mainPart = s
               if (s.includes(" except ")) {
                  const splitExc = s.split(" except ")
                  mainPart = splitExc[0]
                  exceptions = splitExc[1]
                     .trim()
                     .split(" ")
                     .filter((e) => e)
               }
               const strings = mainPart
                  .trim()
                  .toLowerCase()
                  .split(" ")
                  .filter((x) => x)
               const type = strings[0]
               const value = parseInt(strings[1]) || null
               if (!type) return null
               const found = pf2eIWRTypes.find((x) => x.slug === type)
               let label = found ? found.label : type
               if (exceptions.length) {
                  const excLabels = exceptions.map(
                     (e) => pf2eIWRTypes.find((x) => x.slug === e)?.label || e,
                  )
                  label += ` (except ${excLabels.join(", ")})`
               }
               if (value) label += ` ${value}`
               return { type, value, exceptions, label, raw: s.trim() }
            })
            .filter((x) => x)
      }

      const parseExceptions = (str) => {
         if (!str) return []
         return str
            .split(",")
            .map((s) => {
               const raw = s.trim()
               const found = pf2eIWRTypes.find(
                  (x) => x.slug === raw.toLowerCase(),
               )
               return { label: found ? found.label : raw, raw: raw }
            })
            .filter((x) => x.raw)
      }

      part.iwrData = {
         immune: parseIWR(part.iwr.immune),
         weak: parseIWR(part.iwr.weak),
         resist: parseIWR(part.iwr.resist),
         immuneExc: parseExceptions(part.iwr.immuneExc),
         weakExc: parseExceptions(part.iwr.weakExc),
         resistExc: parseExceptions(part.iwr.resistExc),
      }

      part.acceptedDmgTypes = Array.isArray(part.acceptedDmgTypes)
         ? part.acceptedDmgTypes.filter((t) => t)
         : []
      const acceptedDmgTypeChips = part.acceptedDmgTypes.map((slug) => {
         const dt = pf2eDamageTypes.find((t) => t.slug === slug)
         return { slug, label: dt ? dt.label : slug }
      })
      const availableAcceptedDmgTypes = pf2eDamageTypes.filter(
         (dt) => !part.acceptedDmgTypes.includes(dt.slug),
      )

      const allParts = this.workingParts
      part.dependentParts = allParts
         .filter(
            (other) =>
               other.id !== part.id &&
               other.thresholds?.some((t) => t.linkedParts?.includes(part.id)),
         )
         .map((other) => ({ id: other.id, name: other.name }))

      part.thresholds.forEach((t) => {
         t.linkedParts = t.linkedParts || []
         t.linkedPartsData = t.linkedParts.map((id) => {
            const lp = allParts.find((x) => x.id === id)
            return lp
               ? { id, name: lp.name }
               : {
                    id,
                    name: game.i18n.localize(
                       "pf2e-aztecs-rip-n-tear.unknownPart",
                    ),
                 }
         })
         t.conditions = t.conditions || []
         t.effects = t.effects || []
         t.macros = t.macros || []
         t.damages = t.damages || []
         t.ruleElements = t.ruleElements || []
         t.conditions.forEach(
            (c) => (c.hasValue = PF2E_VALUED_CONDITIONS.includes(c.slug)),
         )
      })

      const allItems = this.actor.items
      const linkedItemsData = part.linkedItems.map((id) => {
         if (id === "ALL_SPELLCASTING") {
            return {
               id,
               name: game.i18n.localize("pf2e-aztecs-rip-n-tear.spellcasting"),
               icon: "fa-wand-magic-sparkles",
            }
         }
         const item = allItems.get(id)
         return {
            id,
            name: item
               ? item.name
               : game.i18n.localize(`${MODULE_ID}.unknownItem`),
            icon: "fa-suitcase",
         }
      })

      part.linkedEntries.forEach((id) => {
         const item = allItems.get(id)
         if (item)
            linkedItemsData.push({
               id,
               name: item.name,
               icon: "fa-book-sparkles",
            })
      })

      part.linkedSpells.forEach((id) => {
         const item = allItems.get(id)
         if (item)
            linkedItemsData.push({
               id,
               name: item.name,
               icon: "fa-wand-magic-sparkles",
            })
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
         actor: this.actor,
         part,
         parts: allParts,
         linkedItemsData,
         attacks,
         abilities,
         passives,
         pf2eConditions,
         pf2eDamageTypes,
         pf2eIWRTypes,
         acceptedDmgTypeChips,
         availableAcceptedDmgTypes,
      }
   }

   _saveScrollPos() {
      const scrollable = this.element?.querySelector(".rnt-scrollable")
      if (scrollable) this._savedScrollPos = scrollable.scrollTop
   }

   _onRender(context, options) {
      super._onRender(context, options)

      const html = this.element
      const acInputs = html.querySelectorAll(".rnt-ac-adj-input")

      acInputs.forEach((input) => {
         const display = input.nextElementSibling
         if (!display || !display.classList.contains("rnt-ac-total-display"))
            return

         const baseAc = Number(input.dataset.baseAc) || 0
         const oldAc =
            input.dataset.oldAc !== "" ? Number(input.dataset.oldAc) : NaN

         if (input.value === "" && !isNaN(oldAc)) {
            input.value = oldAc - baseAc
         }

         const updateDisplay = () => {
            const adj = Number(input.value) || 0
            display.textContent = ` = ${baseAc + adj} AC`
         }

         input.addEventListener("input", updateDisplay)
         updateDisplay()
      })

      if (this._savedScrollPos !== undefined) {
         const restore = () => {
            const scrollable = this.element?.querySelector(".rnt-scrollable")
            if (scrollable && scrollable.isConnected) {
               scrollable.scrollTop = this._savedScrollPos
            }
         }
         restore()
         requestAnimationFrame(() => requestAnimationFrame(restore))
         setTimeout(restore, 50)
      }

      const reRenderOnChange = async () => {
         await this._saveCurrentState()
         this._saveScrollPos()
         this.render()
      }

      const useRuptureCheck = this.element.querySelector(
         'input[name="useRupture"]',
      )
      if (useRuptureCheck) {
         useRuptureCheck.addEventListener("change", reRenderOnChange)
      }

      this.element.querySelectorAll(".item-link").forEach((el) => {
         el.addEventListener("click", async (ev) => {
            const id = ev.currentTarget.dataset.id
            const item = this.actor.items.get(id)
            if (item) item.sheet.render(true)
         })
      })

      this.element
         .querySelectorAll('input[type="checkbox"][name^="saves."]')
         .forEach((cb) => {
            cb.addEventListener("change", (e) => {
               const wrapper = e.target.closest(
                  ".rnt-save-inline, .rnt-save-row",
               )
               const numInput = wrapper?.querySelector('input[type="number"]')
               const display = wrapper?.querySelector(".rnt-save-total-display")

               if (numInput && wrapper) {
                  if (e.target.checked) {
                     wrapper.classList.add("rnt-save-active")
                     const currentVal = parseInt(numInput.value, 10)
                     if (isNaN(currentVal)) numInput.value = 0
                     numInput.dispatchEvent(new Event("input"))
                  } else {
                     wrapper.classList.remove("rnt-save-active")
                     if (display) display.textContent = ""
                  }
               }
            })
         })

      this.element.querySelectorAll(".rnt-save-adj-input").forEach((input) => {
         const display = input.nextElementSibling
         if (!display || !display.classList.contains("rnt-save-total-display"))
            return

         const baseSave = Number(input.dataset.baseSave) || 0
         const wrapper = input.closest(".rnt-save-inline, .rnt-save-row")
         const cb = wrapper?.querySelector('input[type="checkbox"]')

         const updateDisplay = () => {
            if (cb && !cb.checked) {
               display.textContent = ""
               return
            }

            const adj = Number(input.value) || 0
            const total = baseSave + adj
            display.textContent = ` = ${total >= 0 ? "+" : ""}${total}`
         }

         input.addEventListener("input", updateDisplay)
         updateDisplay()
      })

      this.element.addEventListener("click", async (ev) => {
         const effectLink = ev.target.closest(".rnt-effect-link")
         if (effectLink) {
            const uuid = effectLink.dataset.uuid
            const item = await fromUuid(uuid)
            if (item) item.sheet.render(true)
         }
      })

      const dealsDmgCheck = this.element.querySelector(
         'input[name="dealsDamage"]',
      )
      if (dealsDmgCheck) {
         dealsDmgCheck.addEventListener("change", async (ev) => {
            const grp = this.element.querySelector(".rnt-persistent-dmg-group")
            if (grp) grp.style.display = ev.target.checked ? "flex" : "none"
            const failGrp = this.element.querySelector(
               ".rnt-failed-rupture-group",
            )
            if (failGrp)
               failGrp.style.display = ev.target.checked ? "flex" : "none"
            await this._saveCurrentState()
         })
      }

      const abilitySelect = this.element.querySelector(".rnt-ability-select")
      if (abilitySelect) {
         abilitySelect.addEventListener("change", async (ev) => {
            const id = ev.currentTarget.value
            if (!id) return
            await this._saveCurrentState()
            const part = this.workingParts.find((p) => p.id === this.partId)
            part.linkedItems = part.linkedItems || []
            if (!part.linkedItems.includes(id)) part.linkedItems.push(id)
            this._saveScrollPos()
            this.render()
         })
      }

      this.element
         .querySelectorAll(".rnt-condition-select")
         .forEach((el) => el.addEventListener("change", reRenderOnChange))

      this.element
         .querySelectorAll(".rnt-threshold-part-select")
         .forEach((el) => {
            el.addEventListener("change", async (ev) => {
               const val = ev.target.value
               const ti = ev.target.dataset.ti
               if (!val) return
               await this._saveCurrentState()
               const part = this.workingParts.find((p) => p.id === this.partId)
               if (!part.thresholds[ti].linkedParts.includes(val)) {
                  part.thresholds[ti].linkedParts.push(val)
                  this._saveScrollPos()
                  this.render()
               }
            })
         })

      this.element
         .querySelectorAll(".rnt-dependent-part-link")
         .forEach((el) => {
            el.addEventListener("click", (ev) => {
               ev.preventDefault()
               const partId = ev.currentTarget.dataset.partId
               new BodyPartApp({ actor: this.actor, partId }).render(true)
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
            if (
               !item ||
               (item.type !== "effect" && item.documentName !== "Macro")
            ) {
               iconEl.src = "icons/svg/hazard.svg"
               nameEl.innerHTML = `<span style="color: darkred; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Invalid Item</span>`
               parent.querySelector('input[name$=".invalid"]').value = "true"
               parent.querySelector('input[name$=".name"]').value =
                  game.i18n.localize("pf2e-aztecs-rip-n-tear.invalidItem")
               parent.querySelector('input[name$=".img"]').value =
                  "icons/svg/hazard.svg"
            } else {
               iconEl.src = item.img || "icons/svg/dice-target.svg"
               nameEl.innerHTML = `<a class="content-link rnt-effect-link" data-uuid="${uuid}"><i class="fa-solid ${item.documentName === "Macro" ? "fa-code" : "fa-suitcase"}"></i> ${item.name}</a>`
               parent.querySelector('input[name$=".invalid"]').value = "false"
               parent.querySelector('input[name$=".name"]').value = item.name
               parent.querySelector('input[name$=".img"]').value =
                  item.img || "icons/svg/dice-target.svg"
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
                  const row = ev.currentTarget.closest(
                     ".rnt-damage-row, .rnt-damage-row-flat, .flexrow",
                  )
                  const catSelect = row?.querySelector(
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
                  game.i18n.localize(`${MODULE_ID}.invalidJson`),
               )
            }
            await this._saveCurrentState()
         })
      })

      const customIWR = this.element.querySelector('input[name="customIWR"]')
      if (customIWR) {
         customIWR.addEventListener("change", reRenderOnChange)
      }

      this.element
         .querySelector('select[name="acceptedDmgTypesSelect"]')
         ?.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            if (!val) return
            await this._saveCurrentState()
            const part = this.workingParts.find((p) => p.id === this.partId)
            if (!part.acceptedDmgTypes) part.acceptedDmgTypes = []
            if (!part.acceptedDmgTypes.includes(val)) {
               part.acceptedDmgTypes.push(val)
               this._saveScrollPos()
               this.render()
            }
         })

      const setupIWRSelect = (id, field) => {
         this.element
            .querySelector(id)
            ?.addEventListener("change", async (ev) => {
               const val = ev.currentTarget.value
               if (!val) return
               let valNum = ""
               if (field === "weak" || field === "resist") {
                  valNum =
                     this.element.querySelector(`#rnt-${field}-value`)?.value ||
                     "5"
               }
               await this._saveCurrentState()
               const parts = this._getParts()
               const part = parts.find((p) => p.id === this.partId)
               if (!part.iwr) part.iwr = {}
               let arr = part.iwr[field]
                  ? part.iwr[field]
                       .split(",")
                       .map((s) => s.trim())
                       .filter((s) => s)
                  : []

               let str = val
               if (valNum) str += ` ${valNum}`

               if (!arr.includes(str)) arr.push(str)
               part.iwr[field] = arr.join(", ")
               await this.actor.setFlag(
                  "pf2e-aztecs-rip-n-tear",
                  "parts",
                  parts,
               )
               this._saveScrollPos()
               this.render()
            })
      }

      setupIWRSelect("#rnt-immune-select", "immune")
      setupIWRSelect("#rnt-weak-select", "weak")
      setupIWRSelect("#rnt-resist-select", "resist")
      setupIWRSelect("#rnt-immune-exc-select", "immuneExc")
      setupIWRSelect("#rnt-weak-exc-select", "weakExc")
      setupIWRSelect("#rnt-resist-exc-select", "resistExc")
   }

   _getParts() {
      return this.workingParts
   }

   async _saveCurrentState() {
      const form = this.element.querySelector("form")
      if (!form) return
      const FDClass =
         foundry.applications?.ux?.FormDataExtended ?? FormDataExtended
      const formData = new FDClass(form)
      const updatedPart = foundry.utils.expandObject(formData.object)

      const index = this.workingParts.findIndex((p) => p.id === this.partId)
      if (index === -1) return
      const currentPart = this.workingParts[index] || {}

      const asString = (v) =>
         Array.isArray(v)
            ? String(v[v.length - 1] ?? "")
            : v == null
              ? ""
              : String(v)

      updatedPart.id = this.partId
      updatedPart.useRupture = !!updatedPart.useRupture
      updatedPart.dealsDamage = !!updatedPart.dealsDamage
      updatedPart.persistentDealsDamage = !!updatedPart.persistentDealsDamage
      updatedPart.failedRuptureDealsDamage =
         !!updatedPart.failedRuptureDealsDamage
      updatedPart.removeEffectsOnFullHeal =
         !!updatedPart.removeEffectsOnFullHeal
      updatedPart.customIWR = !!updatedPart.customIWR
      updatedPart.linkedItems = currentPart.linkedItems || []
      updatedPart.linkedEntries = currentPart.linkedEntries || []
      updatedPart.linkedSpells = currentPart.linkedSpells || []
      updatedPart.isHidden = currentPart.isHidden ?? false

      if (updatedPart.saves) {
         for (const k of ["fortitude", "reflex", "will"]) {
            updatedPart.saves[k] = updatedPart.saves[k] || {}
            updatedPart.saves[k].enabled = !!updatedPart.saves[k].enabled
            const num = parseInt(updatedPart.saves[k].adjustment)
            updatedPart.saves[k].adjustment = isNaN(num) ? 0 : num
            delete updatedPart.saves[k].value
         }
      } else {
         updatedPart.saves = currentPart.saves || {
            fortitude: { enabled: false, adjustment: 0 },
            reflex: { enabled: false, adjustment: 0 },
            will: { enabled: false, adjustment: 0 },
         }
      }

      delete updatedPart.acceptedDmgTypesSelect
      if (!updatedPart.acceptedDmgTypes) updatedPart.acceptedDmgTypes = []
      else if (!Array.isArray(updatedPart.acceptedDmgTypes))
         updatedPart.acceptedDmgTypes = [updatedPart.acceptedDmgTypes]
      updatedPart.acceptedDmgTypes = updatedPart.acceptedDmgTypes
         .flatMap((v) => String(v).split(","))
         .map((v) => v.trim())
         .filter((t) => t)

      if (updatedPart.iwr) {
         updatedPart.iwr.immune = asString(updatedPart.iwr.immune)
         updatedPart.iwr.weak = asString(updatedPart.iwr.weak)
         updatedPart.iwr.resist = asString(updatedPart.iwr.resist)
         updatedPart.iwr.immuneExc = asString(updatedPart.iwr.immuneExc)
         updatedPart.iwr.weakExc = asString(updatedPart.iwr.weakExc)
         updatedPart.iwr.resistExc = asString(updatedPart.iwr.resistExc)
      } else {
         updatedPart.iwr = currentPart.iwr || {
            immune: "",
            weak: "",
            resist: "",
            immuneExc: "",
            weakExc: "",
            resistExc: "",
         }
      }

      const cleanSlug = (v) => {
         const s = asString(v)
         if (s.includes(",")) return s.split(",")[0].trim()
         return s.trim()
      }

      const cleanPath = (v) => {
         const s = asString(v)
         if (s.includes(",")) return s.split(",")[0].trim()
         return s
      }

      if (updatedPart.thresholds) {
         updatedPart.thresholds = Object.values(updatedPart.thresholds).map(
            (t) => {
               t.linkedParts = t.linkedParts
                  ? Array.isArray(t.linkedParts)
                     ? t.linkedParts
                          .flatMap((v) => String(v).split(","))
                          .map((v) => v.trim())
                          .filter((v) => v)
                     : String(t.linkedParts)
                          .split(",")
                          .map((v) => v.trim())
                          .filter((v) => v)
                  : []
               t.disableAbilities = !!t.disableAbilities
               t.hpValue = parseInt(t.hpValue) || 0
               t.customDescription = asString(t.customDescription)
               t.conditions = t.conditions
                  ? Object.values(t.conditions).map((c) => ({
                       slug: cleanSlug(c.slug),
                       value: parseInt(c.value) || 1,
                    }))
                  : []
               t.effects = t.effects
                  ? Object.values(t.effects).map((e) => ({
                       uuid: asString(e.uuid),
                       name: asString(e.name),
                       img: cleanPath(e.img),
                       invalid: String(e.invalid) === "true",
                    }))
                  : []
               t.macros = t.macros
                  ? Object.values(t.macros).map((m) => ({
                       uuid: asString(m.uuid),
                       name: asString(m.name),
                       img: cleanPath(m.img),
                       invalid: String(m.invalid) === "true",
                    }))
                  : []
               t.damages = t.damages
                  ? Object.values(t.damages).map((d) => ({
                       diceNum: parseInt(d.diceNum) || 0,
                       diceStep: asString(d.diceStep),
                       dmgType: asString(d.dmgType),
                       dmgCategory: asString(d.dmgCategory),
                    }))
                  : []
               t.ruleElements = t.ruleElements
                  ? Object.values(t.ruleElements).map((r) => ({
                       json: asString(r.json),
                       invalid: String(r.invalid) === "true",
                    }))
                  : []
               return t
            },
         )
      } else {
         updatedPart.thresholds = []
      }

      this.workingParts[index] = updatedPart
   }

   static async _onSaveChanges(event, target) {
      await this._saveCurrentState()
      captureActorSheetScroll(this.actor)
      await this.actor.setFlag(MODULE_ID, "parts", this.workingParts)
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

   static async _onRemoveImmunity(event, target) {
      const raw = target.dataset.raw
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      let arr = part.iwr?.immune
         ? part.iwr.immune
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
         : []
      arr = arr.filter((s) => s !== raw)
      part.iwr.immune = arr.join(", ")
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveWeakness(event, target) {
      const raw = target.dataset.raw
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      let arr = part.iwr?.weak
         ? part.iwr.weak
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
         : []
      arr = arr.filter((s) => s !== raw)
      part.iwr.weak = arr.join(", ")
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveResistance(event, target) {
      const raw = target.dataset.raw
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      let arr = part.iwr?.resist
         ? part.iwr.resist
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
         : []
      arr = arr.filter((s) => s !== raw)
      part.iwr.resist = arr.join(", ")
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveImmuneExc(event, target) {
      const raw = target.dataset.raw
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      let arr = part.iwr?.immuneExc
         ? part.iwr.immuneExc
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
         : []
      arr = arr.filter((s) => s !== raw)
      part.iwr.immuneExc = arr.join(", ")
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveWeakExc(event, target) {
      const raw = target.dataset.raw
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      let arr = part.iwr?.weakExc
         ? part.iwr.weakExc
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
         : []
      arr = arr.filter((s) => s !== raw)
      part.iwr.weakExc = arr.join(", ")
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveResistExc(event, target) {
      const raw = target.dataset.raw
      await this._saveCurrentState()
      const parts = this._getParts()
      const part = parts.find((p) => p.id === this.partId)
      let arr = part.iwr?.resistExc
         ? part.iwr.resistExc
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
         : []
      arr = arr.filter((s) => s !== raw)
      part.iwr.resistExc = arr.join(", ")
      await this.actor.setFlag("pf2e-aztecs-rip-n-tear", "parts", parts)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveAcceptedDmgType(event, target) {
      const slug = target.dataset.slug
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      if (!part.acceptedDmgTypes) part.acceptedDmgTypes = []
      part.acceptedDmgTypes = part.acceptedDmgTypes.filter((t) => t !== slug)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveLinkedItem(event, target) {
      const id = target.dataset.id
      await this._saveCurrentState()
      const part = this.workingParts.find((p) => p.id === this.partId)
      part.linkedItems = part.linkedItems.filter((i) => i !== id)
      part.linkedEntries = part.linkedEntries.filter((i) => i !== id)
      part.linkedSpells = part.linkedSpells.filter((i) => i !== id)
      this._saveScrollPos()
      this.render()
   }

   static async _onConfigSpellcasting(event, target) {
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
            this._saveScrollPos()
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
            linkedParts: [],
            conditions: [],
            effects: [],
            macros: [],
            damages: [],
            ruleElements: [],
         })
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveThreshold(event, target) {
      const index = parseInt(target.dataset.index, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds.splice(index, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onAddCondition(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].conditions.push({ slug: "off-guard", value: 1 })
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveThresholdPart(event, target) {
      const ti = parseInt(target.dataset.ti, 10)
      const lpi = parseInt(target.dataset.lpi, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[ti].linkedParts.splice(lpi, 1)
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveCondition(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const cIndex = parseInt(target.dataset.ci, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].conditions.splice(cIndex, 1)
      this._saveScrollPos()
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
         })
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveEffect(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const eIndex = parseInt(target.dataset.ei, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].effects.splice(eIndex, 1)
      this._saveScrollPos()
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
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveMacro(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const mIndex = parseInt(target.dataset.mi, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].macros.splice(mIndex, 1)
      this._saveScrollPos()
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
         })
      this._saveScrollPos()
      this.render()
   }

   static async _onRemoveDamage(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const dIndex = parseInt(target.dataset.di, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].damages.splice(dIndex, 1)
      this._saveScrollPos()
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
               })
            this._saveScrollPos()
            this.render()
         },
      }).render(true)
   }

   static async _onRemoveRuleElement(event, target) {
      const tIndex = parseInt(target.dataset.ti, 10)
      const rei = parseInt(target.dataset.rei, 10)
      await this._saveCurrentState()
      this.workingParts
         .find((p) => p.id === this.partId)
         .thresholds[tIndex].ruleElements.splice(rei, 1)
      this._saveScrollPos()
      this.render()
   }
}
