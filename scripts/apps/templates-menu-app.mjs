const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { withRntActorTheme } from "../actor-support.mjs"

export class TemplatesMenuApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   constructor(options = {}) {
      options = withRntActorTheme(options)
      super(options)
      this.actor = options.actor
   }

   static DEFAULT_OPTIONS = {
      id: "rnt-templates-menu",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 360, height: "auto" },
      window: { title: `${MODULE_ID}.templatesMenu` },
      actions: {
         addFrom: this._onAddFrom,
         saveCurrent: this._onSaveCurrent,
         exportTemplate: this._onExportTemplate,
         importTemplate: this._onImportTemplate,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/templates-menu.hbs`,
      },
   }

   async _prepareContext() {
      return {}
   }

   static async _onAddFrom() {
      this.close()
      const m = await import("./template-picker-app.mjs")
      new m.TemplatePickerApp({ actor: this.actor }).render(true)
   }

   static async _onSaveCurrent() {
      this.close()
      const m = await import("./template-builder-app.mjs")
      new m.TemplateBuilderApp({ actor: this.actor }).render(true)
   }

   static async _onExportTemplate() {
      this.close()
      const m = await import("./template-picker-app.mjs")
      new m.TemplatePickerApp({
         actor: this.actor,
         mode: "export",
      }).render(true)
   }

   static async _onImportTemplate() {
      this.close()
      const ie = await import("../import-export.mjs")
      const tmpl = await import("../templates.mjs")
      const env = await ie.pickJsonFile()
      if (!env) return
      const valid = ie.validateEnvelope(env, ["template"])
      if (!valid) return
      const fresh = ie.regenerateTemplateIds(valid.data)
      await tmpl.saveTemplate(fresh)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.templateImported`, {
            name: fresh.name || "Template",
         }),
      )
   }
}
