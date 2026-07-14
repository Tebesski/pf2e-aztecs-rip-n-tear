const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { MODULE_ID } from "../constants.mjs"
import { withRntActorTheme } from "../actor-support.mjs"

export class HideNpcApp extends HandlebarsApplicationMixin(ApplicationV2) {
   constructor(options = {}) {
      options = withRntActorTheme(options)
      super(options)
      this.actor = options.actor
   }

   static DEFAULT_OPTIONS = {
      id: "hide-npc-app",
      classes: ["pf2e", "rnt-app-v2"],
      position: { width: 400, height: "auto" },
      window: { title: `${MODULE_ID}.hideMainNpc` },
      actions: {
         saveConfig: this._onSaveConfig,
      },
   }

   static PARTS = {
      form: { template: `modules/${MODULE_ID}/templates/hide-npc.hbs` },
   }

   async _prepareContext() {
      const config = this.actor.getFlag(MODULE_ID, "hideNpcConfig") || {
         absoluteHide: false,
         connectedParts: [],
      }
      const parts = (this.actor.getFlag(MODULE_ID, "parts") || []).map((p) => ({
         id: p.id,
         name: p.name,
         checked: config.connectedParts.includes(p.id),
      }))
      return { config, parts }
   }

   _onRender(context, options) {
      super._onRender(context, options)
      const absHide = this.element.querySelector('input[name="absoluteHide"]')
      const section = this.element.querySelector("#rnt-connected-parts-section")
      if (absHide && section) {
         absHide.addEventListener("change", (e) => {
            if (e.target.checked) {
               section.style.display = "none"
               section
                  .querySelectorAll('input[type="checkbox"]')
                  .forEach((cb) => (cb.checked = false))
            } else {
               section.style.display = "block"
            }
         })
      }
   }

   static async _onSaveConfig(event, target) {
      const form = this.element.querySelector("form")
      const fd = new FormDataExtended(form)
      const data = foundry.utils.expandObject(fd.object)
      let connected = data.connectedParts || []
      if (!Array.isArray(connected)) connected = [connected]

      await this.actor.setFlag(MODULE_ID, "hideNpcConfig", {
         absoluteHide: !!data.absoluteHide,
         connectedParts: connected,
      })
      this.close()
   }
}
