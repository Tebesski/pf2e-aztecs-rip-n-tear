import { MODULE_ID } from "./constants.mjs"
import {
   injectRipAndTearSection,
   injectRipAndTearVehicleHudStatus,
   injectRipAndTearVehicleTab,
   refreshRipAndTearVehicleHudStatus,
} from "./sheet-injector.mjs"
import { registerCombatHooks } from "./combat-hooks.mjs"
import { registerSettings } from "./settings.mjs"
import { registerReactionHooks } from "./reaction-mechanics.mjs"
import { RntSocketManager } from "./sockets.mjs"
import { RntThresholdDamageCardManager } from "./threshold-damage-card.mjs"
import {
   applySiegeRepairResult,
   hasVehicleRepairTargets,
   promptVehicleRepairTarget,
} from "./repair-integration.mjs"
import {
   collectRntDisabledComponentActionIds,
   getRntLinkableModuleData,
   getStoredRntDisabledComponentActionIds,
   isRntComponentActionDisabled,
   isRntSupportedActor,
   isSiegeVehicleActor,
   isSiegeComponentAction,
   syncRntDisabledModules,
} from "./actor-support.mjs"
import { renderLockedEffectLegacyDialog } from "./dialogs/locked-effect-dialog.mjs"

RntSocketManager.initHooks()
RntThresholdDamageCardManager.initHooks()

function hasRntPartsChange(changes = {}) {
   if (foundry.utils.getProperty(changes, `flags.${MODULE_ID}.parts`) !== undefined)
      return true
   if (
      Object.prototype.hasOwnProperty.call(
         changes,
         `flags.${MODULE_ID}.parts`,
      ) ||
      Object.prototype.hasOwnProperty.call(
         changes,
         `flags.${MODULE_ID}.-=parts`,
      )
   )
      return true

   const flat = foundry.utils.flattenObject(changes)
   return Object.keys(flat).some(
      (key) =>
         key === `flags.${MODULE_ID}.parts` ||
         key === `flags.${MODULE_ID}.-=parts` ||
         key.startsWith(`flags.${MODULE_ID}.parts.`),
   )
}

function hasRntStatusChange(changes = {}) {
   if (hasRntPartsChange(changes)) return true
   for (const key of ["reactions", "deathReaction"]) {
      if (
         foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${key}`) !==
         undefined
      )
         return true
      if (
         Object.prototype.hasOwnProperty.call(
            changes,
            `flags.${MODULE_ID}.${key}`,
         ) ||
         Object.prototype.hasOwnProperty.call(
            changes,
            `flags.${MODULE_ID}.-=${key}`,
         )
      )
         return true
   }

   const flat = foundry.utils.flattenObject(changes)
   return Object.keys(flat).some(
      (key) =>
         key === `flags.${MODULE_ID}.reactions` ||
         key === `flags.${MODULE_ID}.-=reactions` ||
         key.startsWith(`flags.${MODULE_ID}.reactions.`) ||
         key === `flags.${MODULE_ID}.deathReaction` ||
         key === `flags.${MODULE_ID}.-=deathReaction` ||
         key.startsWith(`flags.${MODULE_ID}.deathReaction.`),
   )
}

Hooks.once("init", () => {
   const api = {
      applySiegeRepairResult,
      collectDisabledComponentActionIds: collectRntDisabledComponentActionIds,
      getDisabledComponentActionIds: getStoredRntDisabledComponentActionIds,
      getLinkableModuleData: getRntLinkableModuleData,
      hasVehicleRepairTargets,
      isComponentActionDisabled: isRntComponentActionDisabled,
      isSiegeComponentAction,
      isSupportedActor: isRntSupportedActor,
      promptVehicleRepairTarget,
      syncDisabledModules: syncRntDisabledModules,
   }
   const module = game.modules.get(MODULE_ID)
   if (module) module.api = api
   globalThis.PF2eAztecsRipNTear = api

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
         let parentActor = this.parent
         const sourceActorUuid = this.getFlag(
            MODULE_ID,
            "thresholdSourceActorUuid",
         )
         if (sourceActorUuid) {
            try {
               parentActor = (await fromUuid(sourceActorUuid)) || parentActor
            } catch (_err) {}
         }

         await renderLockedEffectLegacyDialog(parentActor, partName, {
            onHeal: async () => {
               if (!partId || !parentActor) return
               const { HealBodyPartApp } = await import("./apps/heal-app.mjs")
               new HealBodyPartApp({
                  actor: parentActor,
                  partId,
               }).render(true)
            },
            onRemove: () =>
               originalItemDelete.call(this, {
                  ...context,
                  rntForceDelete: true,
               }),
         })
         return false
      }
      return originalItemDelete.call(this, context)
   }
})

Hooks.on("renderActorSheet", (app, html, data) => {
   injectRipAndTearSection(app, html, data)
   if (game.user.isGM && isSiegeVehicleActor(app.actor)) {
      syncRntDisabledModules(app.actor)
   }
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
         } catch (_err) {
         }
      })()
   }
})

Hooks.on("pf2e-aztecs-siege.vehicleSheetTabsReady", (app, html, actor) => {
   injectRipAndTearVehicleTab(app, html, actor)
})

Hooks.on("renderVehicleHUD", (app, html, data) => {
   injectRipAndTearVehicleHudStatus(app, html, data)
})

Hooks.on("renderApplicationV2", (app, html, data) => {
   if (app?.constructor?.name !== "VehicleHUD") return
   injectRipAndTearVehicleHudStatus(app, html, data)
})

Hooks.on("renderApplication", (app, html, data) => {
   if (app?.constructor?.name !== "VehicleHUD") return
   injectRipAndTearVehicleHudStatus(app, html, data)
})

Hooks.on("updateActor", (actor, changes, options, userId) => {
   if (!game.user.isGM || !isRntSupportedActor(actor)) return
   if (hasRntPartsChange(changes)) syncRntDisabledModules(actor)
   if (hasRntStatusChange(changes)) refreshRipAndTearVehicleHudStatus(actor)
})

Hooks.once("ready", () => {
   registerCombatHooks()
   registerReactionHooks()
})
