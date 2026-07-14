const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { withRntActorTheme } from "../actor-support.mjs"

const MODIFIER_CATEGORIES = [
   "speed",
   "save",
   "attack",
   "skill",
   "maxHp",
   "ac",
   "spellDc",
   "spellAttack",
   "initiative",
]

export class RuleElementApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      options = withRntActorTheme(options)
      super(options)
      this.actor = options.actor
      this.partId = options.partId
      this.tIndex = options.tIndex
      this.callback = options.callback
      this.currentCategory = "custom"
   }

   static DEFAULT_OPTIONS = {
      id: "rule-element-builder",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 480, height: "auto" },
      window: { title: `${MODULE_ID}.reBuilderTitle` },
      actions: {
         saveRuleElement: this._onSaveRuleElement,
      },
   }

   static PARTS = {
      form: {
         template: `modules/${MODULE_ID}/templates/rule-element-builder.hbs`,
      },
   }

   async _prepareContext(options) {
      const attacks = this.actor.items
         .filter((i) => i.type === "melee" || i.type === "weapon")
         .map((a) => ({
            id: a.id,
            name: a.name,
            slug: a.slug || game.pf2e.system.sluggify(a.name),
         }))
      const rawTypes = CONFIG.PF2E?.damageTypes ||
         CONFIG.PF2E?.damageTraits || {
            slashing: "Slashing",
            piercing: "Piercing",
            bludgeoning: "Bludgeoning",
            fire: "Fire",
         }
      const dmgTypes = Object.entries(rawTypes)
         .map(([slug, label]) => ({
            slug,
            label: typeof label === "string" ? game.i18n.localize(label) : slug,
         }))
         .sort((a, b) => a.label.localeCompare(b.label))
      const skillsData = CONFIG.PF2E?.skills || {}
      const skills = Object.entries(skillsData)
         .map(([slug, data]) => ({
            slug,
            label: game.i18n.localize(data.label || data),
         }))
         .sort((a, b) => a.label.localeCompare(b.label))

      return {
         category: this.currentCategory,
         attacks,
         dmgTypes,
         skills,
         isCustom: this.currentCategory === "custom",
         isSpeed: this.currentCategory === "speed",
         isSave: this.currentCategory === "save",
         isAttack: this.currentCategory === "attack",
         isDamage: this.currentCategory === "damage",
         isIWR: this.currentCategory === "iwr",
         isSkill: this.currentCategory === "skill",
         isMaxHp: this.currentCategory === "maxHp",
         isAc: this.currentCategory === "ac",
         isSpellDc: this.currentCategory === "spellDc",
         isSpellAttack: this.currentCategory === "spellAttack",
         isInitiative: this.currentCategory === "initiative",
         showModifier: MODIFIER_CATEGORIES.includes(this.currentCategory),
         defaultValue: this.currentCategory === "speed" ? -5 : -1,
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

      const select = this.element.querySelector("#re-category")
      if (select) {
         select.addEventListener("change", (ev) => {
            this.currentCategory = ev.currentTarget.value
            this._saveScrollPos()
            this.render()
         })
      }
   }

   static async _onSaveRuleElement(event, target) {
      const form = this.element.querySelector("form")
      const FDClass =
         foundry.applications?.ux?.FormDataExtended ?? FormDataExtended
      const formData = new FDClass(form)
      const data = formData.object
      let json = {}
      const cat = this.currentCategory

      if (cat === "custom") {
         try {
            json = JSON.parse(data.customJson || "{}")
         } catch (e) {
            json = {}
         }
      } else if (cat === "iwr") {
         json.key = data.iwrType
         json.type = data.dmgType
         if (json.key !== "Immunity") json.value = parseInt(data.value) || 0
      } else if (cat === "damage") {
         json.key = data.dmgKind === "dice" ? "DamageDice" : "FlatModifier"
         json.selector =
            data.attackTarget === "all"
               ? "damage"
               : `${data.attackTarget}-damage`
         if (data.dmgType) json.damageType = data.dmgType

         if (json.key === "DamageDice") {
            json.diceNumber = parseInt(data.diceNum) || 1
            json.dieSize = `d${data.diceStep}`
         } else {
            json.value = parseInt(data.value) || 0
         }
         if (data.dmgCategory) json.category = data.dmgCategory
      } else {
         json.key = "FlatModifier"
         json.value = parseInt(data.value) || 0
         if (data.modType && data.modType !== "untyped")
            json.type = data.modType

         switch (cat) {
            case "speed":
               json.selector = data.speedTarget
               break
            case "save":
               json.selector = data.saveTarget
               break
            case "attack":
               json.selector =
                  data.attackTarget === "all"
                     ? "attack"
                     : `${data.attackTarget}-attack`
               break
            case "skill":
               json.selector = data.skillTarget
               break
            case "maxHp":
               json.selector = "hp"
               break
            case "ac":
               json.selector = "ac"
               break
            case "spellDc":
               json.selector = "spell-dc"
               break
            case "spellAttack":
               json.selector = "spell-attack"
               break
            case "initiative":
               json.selector = "initiative"
               break
         }
      }

      this.callback(JSON.stringify(json, null, 2))
      this.close()
   }
}
