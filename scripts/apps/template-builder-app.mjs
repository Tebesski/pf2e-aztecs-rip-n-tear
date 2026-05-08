const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import {
   getAllTemplates,
   removeTemplateById,
   saveTemplate,
   snapshotFromActor,
} from "../templates.mjs"

export class TemplateBuilderApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this._initWorking()
   }

   _initWorking() {
      const snap = this.actor ? snapshotFromActor(this.actor) : null
      this.working = {
         name: this.actor?.name || "",
         autoApply: false,
         traits: "",
         parts: (snap?.parts || []).map((p) => ({ ...p, _include: true })),
         reactions: (snap?.reactions || []).map((r) => ({
            ...r,
            _include: true,
         })),
         deathReaction: snap?.deathReaction
            ? { ...snap.deathReaction, _include: true }
            : null,
      }
      this.selectedExistingId = null
   }

   static DEFAULT_OPTIONS = {
      id: "rnt-template-builder",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 560, height: "auto" },
      window: { title: `${MODULE_ID}.tplSave` },
      actions: {
         save: this._onSave,
         addPart: this._onAddPart,
         addReaction: this._onAddReaction,
         addDeath: this._onAddDeath,
         editPart: this._onEditPart,
         editReaction: this._onEditReaction,
         editDeath: this._onEditDeath,
         removeBuiltPart: this._onRemoveBuiltPart,
         removeBuiltReaction: this._onRemoveBuiltReaction,
         removeBuiltDeath: this._onRemoveBuiltDeath,
         selectExisting: this._onSelectExisting,
         openExistingElement: this._onOpenExistingElement,
         rewriteExisting: this._onRewriteExisting,
         removeExisting: this._onRemoveExisting,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/template-builder.hbs`,
      },
   }

   async _prepareContext() {
      const all = getAllTemplates()
      const selected = all.find((t) => t.id === this.selectedExistingId) || null
      return {
         working: this.working,
         hasDeath: !!this.working.deathReaction,
         existing: all,
         selected,
      }
   }

   _onRender(context, options) {
      this._captureField("input[name='tplName']", "name", "value", true)
      this._captureField(
         "input[name='tplAutoApply']",
         "autoApply",
         "checked",
         false,
         () => {
            if (
               this.working.autoApply &&
               !this.working.traits &&
               this.actor?.system?.traits?.value?.length
            ) {
               this.working.traits = this.actor.system.traits.value.join(", ")
            }
            this.render()
         },
      )
      this._captureField("input[name='tplTraits']", "traits", "value", true)
      this.element.querySelectorAll("input[data-include-key]").forEach((cb) => {
         cb.addEventListener("change", () => {
            const key = cb.dataset.includeKey
            const id = cb.dataset.id
            if (key === "death") {
               if (this.working.deathReaction)
                  this.working.deathReaction._include = cb.checked
               return
            }
            const list = this.working[key]
            const item = list.find((x) => x.id === id)
            if (item) item._include = cb.checked
         })
      })
   }

   _captureField(selector, key, prop, raw = false, after) {
      const el = this.element.querySelector(selector)
      if (!el) return
      el.addEventListener("input", () => {
         this.working[key] = raw ? el[prop] : !!el[prop]
         if (after) after()
      })
      el.addEventListener("change", () => {
         this.working[key] = raw ? el[prop] : !!el[prop]
         if (after) after()
      })
   }

   async _editElement(kind, id) {
      if (!this.actor) {
         const candidate =
            canvas?.tokens?.controlled?.[0]?.actor ||
            game.user?.character ||
            null
         if (candidate) {
            this.actor = candidate
            ui.notifications.info(
               game.i18n.format(`${MODULE_ID}.tplUsingActor`, {
                  name: candidate.name,
               }),
            )
         } else {
            ui.notifications.warn(
               game.i18n.localize(`${MODULE_ID}.tplNeedActor`),
            )
            return
         }
      }
      const list =
         kind === "part"
            ? this.working.parts
            : kind === "reaction"
              ? this.working.reactions
              : null
      let record
      if (kind === "death") {
         record = this.working.deathReaction
      } else {
         record = list.find((x) => x.id === id)
      }
      if (!record) return

      if (kind === "part") {
         const allParts = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "parts") || [],
         )
         allParts.push({ ...record })
         await this.actor.setFlag(MODULE_ID, "parts", allParts)
         const m = await import("./body-part-app.mjs")
         const ed = new m.BodyPartApp({ actor: this.actor, partId: record.id })
         ed.render(true)
         this._waitForCloseAndPull(ed, async () => {
            const fresh = (this.actor.getFlag(MODULE_ID, "parts") || []).find(
               (x) => x.id === record.id,
            )
            if (fresh) {
               const idx = this.working.parts.findIndex(
                  (x) => x.id === record.id,
               )
               if (idx >= 0)
                  this.working.parts[idx] = {
                     ...fresh,
                     _include: record._include,
                  }
            }
            const cleaned = (
               this.actor.getFlag(MODULE_ID, "parts") || []
            ).filter((x) => x.id !== record.id)
            await this.actor.setFlag(MODULE_ID, "parts", cleaned)
            this.render()
         })
      } else if (kind === "reaction") {
         const all = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "reactions") || [],
         )
         all.push({ ...record })
         await this.actor.setFlag(MODULE_ID, "reactions", all)
         const m = await import("./reaction-app.mjs")
         const ed = new m.ReactionApp({
            actor: this.actor,
            reactionId: record.id,
         })
         ed.render(true)
         this._waitForCloseAndPull(ed, async () => {
            const fresh = (
               this.actor.getFlag(MODULE_ID, "reactions") || []
            ).find((x) => x.id === record.id)
            if (fresh) {
               const idx = this.working.reactions.findIndex(
                  (x) => x.id === record.id,
               )
               if (idx >= 0)
                  this.working.reactions[idx] = {
                     ...fresh,
                     _include: record._include,
                  }
            }
            const cleaned = (
               this.actor.getFlag(MODULE_ID, "reactions") || []
            ).filter((x) => x.id !== record.id)
            await this.actor.setFlag(MODULE_ID, "reactions", cleaned)
            this.render()
         })
      } else if (kind === "death") {
         const existingDeath = this.actor.getFlag(MODULE_ID, "deathReaction")
         await this.actor.setFlag(
            MODULE_ID,
            "_tplBuilderPrevDeath",
            existingDeath || null,
         )
         await this.actor.setFlag(MODULE_ID, "deathReaction", { ...record })
         const m = await import("./death-reaction-app.mjs")
         const ed = new m.DeathReactionApp({ actor: this.actor })
         ed.render(true)
         this._waitForCloseAndPull(ed, async () => {
            const fresh = this.actor.getFlag(MODULE_ID, "deathReaction")
            if (fresh) {
               this.working.deathReaction = {
                  ...fresh,
                  _include: record._include,
               }
            }
            const prev = this.actor.getFlag(MODULE_ID, "_tplBuilderPrevDeath")
            if (prev) await this.actor.setFlag(MODULE_ID, "deathReaction", prev)
            else await this.actor.unsetFlag(MODULE_ID, "deathReaction")
            await this.actor.unsetFlag(MODULE_ID, "_tplBuilderPrevDeath")
            this.render()
         })
      }
   }

   _waitForCloseAndPull(app, cb) {
      const origClose = app.close.bind(app)
      app.close = async (...args) => {
         const r = await origClose(...args)
         try {
            await cb()
         } catch (e) {
            console.error("Rip & Tear | Template builder pull-back failed", e)
         }
         return r
      }
   }

   static async _onAddPart() {
      const id = foundry.utils.randomID()
      const newPart = {
         id,
         name: game.i18n.localize(`${MODULE_ID}.newBodyPart`),
         hp: { value: 5, max: 5 },
         ac: 10,
         hardness: 0,
         dealsDamage: true,
         persistentDealsDamage: false,
         multiplier: 1,
         linkedItems: [],
         linkedEntries: [],
         linkedSpells: [],
         thresholds: [],
         removeEffectsOnFullHeal: true,
         customIWR: false,
         iwr: { immune: "", weak: "", resist: "" },
         isHidden: false,
         _include: true,
      }
      this.working.parts.push(newPart)
      this.render()
   }

   static async _onAddReaction() {
      const id = foundry.utils.randomID()
      this.working.reactions.push({
         id,
         name: "New Reaction",
         actionType: "reaction",
         minDamage: 0,
         reactTo: "both",
         allParts: true,
         specificParts: [],
         damageTypes: [],
         disabled: false,
         triggers: [],
         _include: true,
      })
      this.render()
   }

   static async _onAddDeath() {
      this.working.deathReaction = {
         id: foundry.utils.randomID(),
         name: "New Death Reaction",
         useDelay: false,
         delayRounds: 1,
         expiry: "turn-end",
         triggers: [],
         _include: true,
      }
      this.render()
   }

   static async _onEditPart(event, target) {
      await this._editElement("part", target.dataset.id)
   }

   static async _onEditReaction(event, target) {
      await this._editElement("reaction", target.dataset.id)
   }

   static async _onEditDeath() {
      await this._editElement("death")
   }

   static async _onRemoveBuiltPart(event, target) {
      const id = target.dataset.id
      this.working.parts = this.working.parts.filter((p) => p.id !== id)
      this.render()
   }

   static async _onRemoveBuiltReaction(event, target) {
      const id = target.dataset.id
      this.working.reactions = this.working.reactions.filter((r) => r.id !== id)
      this.render()
   }

   static async _onRemoveBuiltDeath() {
      this.working.deathReaction = null
      this.render()
   }

   _buildTemplatePayload() {
      const t = this.working
      const stripInclude = (x) => {
         const c = { ...x }
         delete c._include
         return c
      }
      const resetPartHp = (p) => {
         const c = { ...p }
         if (c.hp && typeof c.hp === "object") {
            c.hp = { ...c.hp, value: c.hp.max }
         }
         c.linkedItems = []
         c.linkedEntries = []
         c.linkedSpells = []
         return c
      }
      const traits = String(t.traits || "")
         .split(",")
         .map((s) => s.trim())
         .filter(Boolean)
      return {
         name: (t.name || "Untitled").trim(),
         autoApply: !!t.autoApply,
         traits,
         parts: t.parts
            .filter((p) => p._include)
            .map(stripInclude)
            .map(resetPartHp),
         reactions: t.reactions.filter((r) => r._include).map(stripInclude),
         deathReaction:
            t.deathReaction && t.deathReaction._include
               ? stripInclude(t.deathReaction)
               : null,
      }
   }

   static async _onSave() {
      if (!this.working.name || !this.working.name.trim()) {
         ui.notifications.warn(
            game.i18n.localize(`${MODULE_ID}.templateNameRequired`),
         )
         return
      }
      const payload = {
         id: foundry.utils.randomID(),
         ...this._buildTemplatePayload(),
      }
      await saveTemplate(payload)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.templateSaved`, { name: payload.name }),
      )
      this.render()
   }

   static async _onSelectExisting(event, target) {
      this.selectedExistingId = target.dataset.id
      this.render()
   }

   static async _onOpenExistingElement(event, target) {
      const tplId = target.dataset.tplId
      const kind = target.dataset.kind
      const id = target.dataset.id
      const tpl = getAllTemplates().find((t) => t.id === tplId)
      if (!tpl) return
      const list =
         kind === "part"
            ? tpl.parts
            : kind === "reaction"
              ? tpl.reactions
              : null
      const record =
         kind === "death" ? tpl.deathReaction : list?.find((x) => x.id === id)
      if (!record) return
      const cloned = { ...foundry.utils.deepClone(record), _include: true }
      const saveBack = async () => {
         const stripped = { ...cloned }
         delete stripped._include
         const all = getAllTemplates()
         const liveTpl = all.find((t) => t.id === tplId)
         if (!liveTpl) return
         if (kind === "part") {
            const idx = liveTpl.parts.findIndex((x) => x.id === record.id)
            if (idx >= 0) liveTpl.parts[idx] = stripped
         } else if (kind === "reaction") {
            const idx = liveTpl.reactions.findIndex((x) => x.id === record.id)
            if (idx >= 0) liveTpl.reactions[idx] = stripped
         } else {
            liveTpl.deathReaction = stripped
         }
         await saveTemplate(liveTpl)
         this.render()
      }
      if (kind === "part") this.working.parts.push(cloned)
      else if (kind === "reaction") this.working.reactions.push(cloned)
      else this.working.deathReaction = cloned

      const idAfter = cloned.id || record.id
      cloned.id = idAfter
      await this._editElement(kind, idAfter)

      saveBack()
      if (kind === "part")
         this.working.parts = this.working.parts.filter((x) => x.id !== idAfter)
      else if (kind === "reaction")
         this.working.reactions = this.working.reactions.filter(
            (x) => x.id !== idAfter,
         )
      else this.working.deathReaction = null
   }

   static async _onRewriteExisting(event, target) {
      const id = target.dataset.id
      const all = getAllTemplates()
      const tpl = all.find((t) => t.id === id)
      if (!tpl) return
      const confirmed = await Dialog.confirm({
         title: game.i18n.localize(`${MODULE_ID}.rewriteTemplate`),
         content: `<p>${game.i18n.format(`${MODULE_ID}.rewriteTemplateConfirm`, { name: tpl.name })}</p>`,
      })
      if (!confirmed) return
      const payload = {
         id: tpl.id,
         ...this._buildTemplatePayload(),
         name: tpl.name,
      }
      await saveTemplate(payload)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.templateSaved`, { name: payload.name }),
      )
      this.render()
   }

   static async _onRemoveExisting(event, target) {
      const id = target.dataset.id
      const all = getAllTemplates()
      const tpl = all.find((t) => t.id === id)
      if (!tpl) return
      const confirmed = await Dialog.confirm({
         title: game.i18n.localize(`${MODULE_ID}.removeTemplate`),
         content: `<p>${game.i18n.format(`${MODULE_ID}.removeTemplateConfirm`, { name: tpl.name })}</p>`,
      })
      if (!confirmed) return
      await removeTemplateById(id)
      if (this.selectedExistingId === id) this.selectedExistingId = null
      this.render()
   }
}
