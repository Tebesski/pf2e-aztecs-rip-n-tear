const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { applyTemplateToActor, getAllTemplates } from "../templates.mjs"

export class TemplatePickerApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.actor = options.actor
      this.mode = options.mode || "add"
      this.selectedId = null
      this.workingFilter = null
   }

   static DEFAULT_OPTIONS = {
      id: "rnt-template-picker",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 480, height: "auto" },
      window: { title: `${MODULE_ID}.tplAddFrom` },
      actions: {
         pick: this._onPick,
         back: this._onBack,
         confirm: this._onConfirm,
         openElement: this._onOpenElement,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/template-picker.hbs`,
      },
   }

   async _prepareContext() {
      const all = getAllTemplates()
      const selected = all.find((t) => t.id === this.selectedId) || null
      const isExport = this.mode === "export"
      const titleKey = isExport ? "tplExport" : "tplAddFrom"
      this.options.window.title = game.i18n.localize(`${MODULE_ID}.${titleKey}`)

      let elements = null
      if (selected && this.workingFilter) {
         elements = {
            parts: selected.parts.map((p) => ({
               ...p,
               _checked: this.workingFilter.partIds.has(p.id),
            })),
            reactions: selected.reactions.map((r) => ({
               ...r,
               _checked: this.workingFilter.reactionIds.has(r.id),
            })),
            deathReaction: selected.deathReaction
               ? {
                    ...selected.deathReaction,
                    _checked: this.workingFilter.includeDeath,
                 }
               : null,
         }
      }

      return {
         all,
         selected,
         elements,
         isExport,
         confirmLabel: isExport
            ? game.i18n.localize(`${MODULE_ID}.tplExport`)
            : game.i18n.localize(`${MODULE_ID}.tplAddBtn`),
      }
   }

   _onRender() {
      this.element.querySelectorAll("input[data-filter-key]").forEach((cb) => {
         cb.addEventListener("change", () => {
            if (!this.workingFilter) return
            const key = cb.dataset.filterKey
            const id = cb.dataset.id
            if (key === "death") {
               this.workingFilter.includeDeath = cb.checked
            } else if (key === "part") {
               if (cb.checked) this.workingFilter.partIds.add(id)
               else this.workingFilter.partIds.delete(id)
            } else if (key === "reaction") {
               if (cb.checked) this.workingFilter.reactionIds.add(id)
               else this.workingFilter.reactionIds.delete(id)
            }
         })
      })
   }

   static async _onPick(event, target) {
      this.selectedId = target.dataset.id
      const tpl = getAllTemplates().find((t) => t.id === this.selectedId)
      if (!tpl) return
      this.workingFilter = {
         partIds: new Set(tpl.parts.map((p) => p.id)),
         reactionIds: new Set(tpl.reactions.map((r) => r.id)),
         includeDeath: !!tpl.deathReaction,
      }
      this.render()
   }

   static async _onBack() {
      this.selectedId = null
      this.workingFilter = null
      this.render()
   }

   static async _onOpenElement(event, target) {
      const tplId = target.dataset.tplId
      const kind = target.dataset.kind
      const id = target.dataset.id
      if (!this.actor) {
         const candidate =
            canvas?.tokens?.controlled?.[0]?.actor ||
            game.user?.character ||
            null
         if (candidate) {
            this.actor = candidate
         } else {
            ui.notifications.warn(
               game.i18n.localize(`${MODULE_ID}.tplNeedActor`),
            )
            return
         }
      }
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

      if (kind === "part") {
         const parts = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "parts") || [],
         )
         const tmpId = foundry.utils.randomID()
         parts.push({ ...foundry.utils.deepClone(record), id: tmpId })
         await this.actor.setFlag(MODULE_ID, "parts", parts)
         const m = await import("./body-part-app.mjs")
         const ed = new m.BodyPartApp({ actor: this.actor, partId: tmpId })
         this._cleanupOnClose(ed, async () => {
            const cleaned = (
               this.actor.getFlag(MODULE_ID, "parts") || []
            ).filter((x) => x.id !== tmpId)
            await this.actor.setFlag(MODULE_ID, "parts", cleaned)
         })
         ed.render(true)
      } else if (kind === "reaction") {
         const reactions = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "reactions") || [],
         )
         const tmpId = foundry.utils.randomID()
         reactions.push({ ...foundry.utils.deepClone(record), id: tmpId })
         await this.actor.setFlag(MODULE_ID, "reactions", reactions)
         const m = await import("./reaction-app.mjs")
         const ed = new m.ReactionApp({ actor: this.actor, reactionId: tmpId })
         this._cleanupOnClose(ed, async () => {
            const cleaned = (
               this.actor.getFlag(MODULE_ID, "reactions") || []
            ).filter((x) => x.id !== tmpId)
            await this.actor.setFlag(MODULE_ID, "reactions", cleaned)
         })
         ed.render(true)
      } else if (kind === "death") {
         const prev = this.actor.getFlag(MODULE_ID, "deathReaction")
         await this.actor.setFlag(
            MODULE_ID,
            "_tplPickerPrevDeath",
            prev || null,
         )
         await this.actor.setFlag(
            MODULE_ID,
            "deathReaction",
            foundry.utils.deepClone(record),
         )
         const m = await import("./death-reaction-app.mjs")
         const ed = new m.DeathReactionApp({ actor: this.actor })
         this._cleanupOnClose(ed, async () => {
            const stash = this.actor.getFlag(MODULE_ID, "_tplPickerPrevDeath")
            if (stash)
               await this.actor.setFlag(MODULE_ID, "deathReaction", stash)
            else await this.actor.unsetFlag(MODULE_ID, "deathReaction")
            await this.actor.unsetFlag(MODULE_ID, "_tplPickerPrevDeath")
         })
         ed.render(true)
      }
   }

   _cleanupOnClose(app, cb) {
      const orig = app.close.bind(app)
      app.close = async (...args) => {
         const r = await orig(...args)
         try {
            await cb()
         } catch (e) {
            console.error("Rip & Tear | Template picker cleanup failed", e)
         }
         return r
      }
   }

   _filterTemplate() {
      const tpl = getAllTemplates().find((t) => t.id === this.selectedId)
      if (!tpl || !this.workingFilter) return null
      return {
         ...tpl,
         id: foundry.utils.randomID(),
         parts: tpl.parts
            .filter((p) => this.workingFilter.partIds.has(p.id))
            .map((p) => foundry.utils.deepClone(p)),
         reactions: tpl.reactions
            .filter((r) => this.workingFilter.reactionIds.has(r.id))
            .map((r) => foundry.utils.deepClone(r)),
         deathReaction:
            tpl.deathReaction && this.workingFilter.includeDeath
               ? foundry.utils.deepClone(tpl.deathReaction)
               : null,
      }
   }

   static async _onConfirm() {
      const filtered = this._filterTemplate()
      if (!filtered) return
      if (this.mode === "export") {
         const ie = await import("../import-export.mjs")
         ie.downloadJson(
            ie.buildTemplateExport(filtered),
            ie.safeFilename(`template-${filtered.name || "untitled"}`),
         )
         this.close()
         return
      }
      const hasExisting =
         (this.actor.getFlag(MODULE_ID, "parts") || []).length > 0 ||
         (this.actor.getFlag(MODULE_ID, "reactions") || []).length > 0 ||
         this.actor.getFlag(MODULE_ID, "deathReaction")
      let mode = "append"
      if (hasExisting) {
         const choice = await foundry.applications.api.DialogV2.wait({
            window: {
               title: game.i18n.localize(`${MODULE_ID}.tplExistingTitle`),
            },
            content: `<p>${game.i18n.localize(`${MODULE_ID}.tplExistingPrompt`)}</p>`,
            buttons: [
               {
                  action: "append",
                  icon: "fa-solid fa-plus",
                  label: game.i18n.localize(`${MODULE_ID}.tplAppend`),
               },
               {
                  action: "replace",
                  icon: "fa-solid fa-arrow-rotate-left",
                  label: game.i18n.localize(`${MODULE_ID}.tplReplace`),
               },
               {
                  action: "cancel",
                  icon: "fa-solid fa-xmark",
                  label: game.i18n.localize(`${MODULE_ID}.cancel`),
               },
            ],
            default: "append",
         })
         if (!choice) return
         mode = choice
      }
      await applyTemplateToActor(this.actor, filtered, mode)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.templateApplied`, {
            name: filtered.name,
         }),
      )
      this.close()
   }
}
