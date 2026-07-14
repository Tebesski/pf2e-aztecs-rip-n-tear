const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID, buildPf2eDamageTypes } from "../../constants.mjs"
import { applyBodyPartDamage } from "../../mechanics.mjs"
import { getActorSaveMod, withRntActorTheme } from "../../actor-support.mjs"
import { formatIwrStr, getActorIwrFallback } from "./common.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates`

export class DamageBodyPartApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      options = withRntActorTheme(options)
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
         const baseFort = getActorSaveMod(this.actor, "fortitude")
         const baseRef = getActorSaveMod(this.actor, "reflex")
         const baseWill = getActorSaveMod(this.actor, "will")

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

   _saveScrollPos() {
      const scrollable = this.element?.querySelector(".rnt-scrollable")
      if (scrollable) this._savedScrollPos = scrollable.scrollTop
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

