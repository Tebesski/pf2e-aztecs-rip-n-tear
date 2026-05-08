const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import {
   getAllTemplates,
   removeTemplatesByIds,
   saveTemplate,
} from "../templates.mjs"

export class ManageTemplatesApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      super(options)
      this.selected = new Set()
   }

   static DEFAULT_OPTIONS = {
      id: "rnt-manage-templates",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 560, height: "auto" },
      window: { title: `${MODULE_ID}.manageTemplates` },
      actions: {
         toggleAll: this._onToggleAll,
         openTemplate: this._onOpenTemplate,
         exportOne: this._onExportOne,
         removeOne: this._onRemoveOne,
         exportSelected: this._onExportSelected,
         removeSelected: this._onRemoveSelected,
         importTemplate: this._onImportTemplate,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/manage-templates.hbs`,
      },
   }

   async _prepareContext() {
      const all = getAllTemplates()
      const live = new Set(all.map((t) => t.id))
      for (const id of [...this.selected]) {
         if (!live.has(id)) this.selected.delete(id)
      }
      return {
         templates: all.map((t) => ({
            ...t,
            _selected: this.selected.has(t.id),
         })),
         allChecked:
            all.length > 0 && all.every((t) => this.selected.has(t.id)),
         hasSelection: this.selected.size > 0,
      }
   }

   _onRender() {
      this.element.querySelectorAll("input[data-tpl-select]").forEach((cb) => {
         cb.addEventListener("change", () => {
            const id = cb.dataset.tplSelect
            if (cb.checked) this.selected.add(id)
            else this.selected.delete(id)
            this.render()
         })
      })
   }

   static async _onToggleAll(event, target) {
      const all = getAllTemplates()
      const allChecked = all.every((t) => this.selected.has(t.id))
      if (allChecked) this.selected.clear()
      else for (const t of all) this.selected.add(t.id)
      this.render()
   }

   static async _onOpenTemplate(event, target) {
      const id = target.dataset.id
      const actor =
         canvas?.tokens?.controlled?.[0]?.actor || game.user.character || null
      const m = await import("./template-builder-app.mjs")
      const app = new m.TemplateBuilderApp({ actor })
      app.selectedExistingId = id
      const tpl = getAllTemplates().find((t) => t.id === id)
      if (tpl) {
         app.working = {
            name: tpl.name,
            autoApply: !!tpl.autoApply,
            traits: (tpl.traits || []).join(", "),
            parts: (tpl.parts || []).map((p) => ({
               ...foundry.utils.deepClone(p),
               _include: true,
            })),
            reactions: (tpl.reactions || []).map((r) => ({
               ...foundry.utils.deepClone(r),
               _include: true,
            })),
            deathReaction: tpl.deathReaction
               ? {
                    ...foundry.utils.deepClone(tpl.deathReaction),
                    _include: true,
                 }
               : null,
         }
      }
      app.render(true)
   }

   static async _onExportOne(event, target) {
      const id = target.dataset.id
      const tpl = getAllTemplates().find((t) => t.id === id)
      if (!tpl) return
      const ie = await import("../import-export.mjs")
      ie.downloadJson(
         ie.buildTemplateExport(tpl),
         ie.safeFilename(`template-${tpl.name}`),
      )
   }

   static async _onRemoveOne(event, target) {
      const id = target.dataset.id
      const tpl = getAllTemplates().find((t) => t.id === id)
      if (!tpl) return
      const confirmed = await Dialog.confirm({
         title: game.i18n.localize(`${MODULE_ID}.removeTemplate`),
         content: `<p>${game.i18n.format(`${MODULE_ID}.removeTemplateConfirm`, { name: tpl.name })}</p>`,
      })
      if (!confirmed) return
      await removeTemplatesByIds([id])
      this.selected.delete(id)
      this.render()
   }

   static async _onExportSelected() {
      const all = getAllTemplates().filter((t) => this.selected.has(t.id))
      if (!all.length) return
      const ie = await import("../import-export.mjs")
      for (const tpl of all) {
         ie.downloadJson(
            ie.buildTemplateExport(tpl),
            ie.safeFilename(`template-${tpl.name}`),
         )
      }
   }

   static async _onRemoveSelected() {
      if (!this.selected.size) return
      const confirmed = await Dialog.confirm({
         title: game.i18n.localize(`${MODULE_ID}.removeTemplate`),
         content: `<p>${game.i18n.format(`${MODULE_ID}.removeTemplatesConfirmCount`, { count: this.selected.size })}</p>`,
      })
      if (!confirmed) return
      await removeTemplatesByIds([...this.selected])
      this.selected.clear()
      this.render()
   }

   static async _onImportTemplate() {
      const ie = await import("../import-export.mjs")
      const env = await ie.pickJsonFile()
      if (!env) return
      const valid = ie.validateEnvelope(env, ["template"])
      if (!valid) return
      const fresh = ie.regenerateTemplateIds(valid.data)
      await saveTemplate(fresh)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.templateImported`, {
            name: fresh.name || "Template",
         }),
      )
      this.render()
   }
}
