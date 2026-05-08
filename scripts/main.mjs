import { MODULE_ID } from "./constants.mjs"
import { injectRipAndTearSection } from "./sheet-injector.mjs"
import { registerCombatHooks } from "./combat-hooks.mjs"
import { registerSettings } from "./settings.mjs"
import { registerReactionHooks } from "./reaction-mechanics.mjs"

Hooks.once("init", () => {
   registerSettings()

   Handlebars.registerHelper("includes", (arr, val) =>
      arr && typeof arr.includes === "function" ? arr.includes(val) : false,
   )

   const itemClass = CONFIG.Item.documentClass
   const originalItemDelete = itemClass.prototype.delete
   itemClass.prototype.delete = async function (context = {}) {
      const isBodyPartEffect = this.getFlag(MODULE_ID, "isBodyPartEffect")
      if (isBodyPartEffect && !context?.rntForceDelete) {
         const partName =
            this.getFlag(MODULE_ID, "bodyPartName") ||
            game.i18n.localize(`${MODULE_ID}.unknownItem`)
         const partId = this.getFlag(MODULE_ID, "partId")
         const parentActor = this.parent

         new Dialog(
            {
               title: game.i18n.localize(`${MODULE_ID}.lockedEffectTitle`),
               content: `<p>${game.i18n.format(`${MODULE_ID}.lockedEffectChoiceContent`, { partName })}</p>`,
               buttons: {
                  heal: {
                     icon: '<i class="fa-solid fa-heart-circle-plus"></i>',
                     label: game.i18n.localize(`${MODULE_ID}.healBodyPart`),
                     callback: async () => {
                        if (!partId || !parentActor) return
                        const { HealBodyPartApp } =
                           await import("./apps/heal-app.mjs")
                        new HealBodyPartApp({
                           actor: parentActor,
                           partId,
                        }).render(true)
                     },
                  },
                  remove: {
                     icon: '<i class="fa-solid fa-trash"></i>',
                     label: game.i18n.localize(`${MODULE_ID}.removeEffect`),
                     callback: () =>
                        originalItemDelete.call(this, {
                           ...context,
                           rntForceDelete: true,
                        }),
                  },
                  cancel: {
                     icon: '<i class="fa-solid fa-xmark"></i>',
                     label: game.i18n.localize(`${MODULE_ID}.cancel`),
                  },
               },
               default: "cancel",
            },
            { width: 520 },
         ).render(true)
         return false
      }
      return originalItemDelete.call(this, context)
   }
})

Hooks.on("renderActorSheet", (app, html, data) => {
   injectRipAndTearSection(app, html, data)
   if (game.user.isGM && app.actor?.type === "npc" && !app.actor.compendium) {
      ;(async () => {
         try {
            const m = await import("./templates.mjs")
            if (m.hasAutoApplyRun(app.actor)) return
            window.RNT_AUTOAPPLY_INFLIGHT =
               window.RNT_AUTOAPPLY_INFLIGHT || new Set()
            if (window.RNT_AUTOAPPLY_INFLIGHT.has(app.actor.uuid)) return
            window.RNT_AUTOAPPLY_INFLIGHT.add(app.actor.uuid)
            try {
               await m.markAutoApplyRun(app.actor)
               const matches = m.findAutoApplyTemplatesForActor(app.actor)
               if (!matches.length) return
               for (const tpl of matches) {
                  await m.applyTemplateToActor(app.actor, tpl, "append")
               }
               ui.notifications.info(
                  game.i18n.format(`${MODULE_ID}.autoAppliedTemplates`, {
                     count: matches.length,
                     name: app.actor.name,
                  }),
               )
            } finally {
               window.RNT_AUTOAPPLY_INFLIGHT.delete(app.actor.uuid)
            }
         } catch (err) {
            console.error("Rip & Tear | Auto-apply templates failed", err)
         }
      })()
   }
})

Hooks.once("ready", () => {
   registerCombatHooks()
   registerReactionHooks()
})
