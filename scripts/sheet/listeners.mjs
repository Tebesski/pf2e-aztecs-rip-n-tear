import { MODULE_ID } from "../constants.mjs"
import { BodyPartApp, DamageBodyPartApp } from "../apps/body-part-app.mjs"
import { HealBodyPartApp } from "../apps/heal-app.mjs"
import { ReactionApp } from "../apps/reaction-app.mjs"
import { DeathReactionApp } from "../apps/death-reaction-app.mjs"
import { setBodyPartHp } from "../mechanics.mjs"
import { triggerReaction } from "../reaction-mechanics.mjs"
import { renderDialogMessage } from "../dialogs/content.mjs"
import { strongText } from "../html-format.mjs"
import {
   getActorBaseAc,
   getDefaultBodyPartIcon,
   getActorHardness,
   getActorHpMax,
   withRntDialogTheme,
} from "../actor-support.mjs"
import { captureActorSheetScroll } from "./scroll.mjs"

export function getItemId(el) {
   return (
      el.dataset.partId || el.dataset.reactionId || el.dataset.deathReactionId
   )
}

function getClosestItemId(target, fallbackKey = "partId") {
   return (
      target.dataset[fallbackKey] ||
      target.closest(".item")?.dataset[fallbackKey]
   )
}

function bindClick(container, selector, handler) {
   container.find(selector).off("click").on("click", handler)
}

export function activateRipAndTearListeners(app, container) {
   bindClick(container, ".rnt-hide-npc", async (ev) => {
      ev.preventDefault()
      const m = await import("../apps/hide-npc-app.mjs")
      new m.HideNpcApp({ actor: app.actor }).render(true)
   })

   bindClick(container, ".rnt-add-part", async (ev) => {
      ev.preventDefault()
      const parts = app.actor.getFlag(MODULE_ID, "parts") || []
      const baseHp = getActorHpMax(app.actor) || 10
      const partHp = Math.max(1, Math.floor(baseHp * 0.1))
      const actorHardness = getActorHardness(app.actor)

      parts.push({
         id: foundry.utils.randomID(),
         name: game.i18n.localize(`${MODULE_ID}.newBodyPart`),
         img: getDefaultBodyPartIcon(app.actor),
         hp: { value: partHp, max: partHp },
         ac: getActorBaseAc(app.actor) + 2,
         acAdjustment: 2,
         hardness: actorHardness,
         dealsDamage: true,
         persistentDealsDamage: false,
         multiplier: 1,
         linkedItems: [],
         linkedEntries: [],
         linkedSpells: [],
         linkedModules: [],
         thresholds: [],
         removeEffectsOnFullHeal: true,
         customIWR: false,
         iwr: { immune: "", weak: "", resist: "" },
         isHidden: false,
      })
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "parts", parts)
   })

   bindClick(container, ".rnt-toggle-hidden", async (ev) => {
      ev.preventDefault()
      const partId = getClosestItemId(ev.currentTarget)
      const parts = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "parts") || [],
      )
      const part = parts.find((p) => p.id === partId)
      if (part) {
         part.isHidden = !part.isHidden
         captureActorSheetScroll(app.actor)
         await app.actor.setFlag(MODULE_ID, "parts", parts)
      }
   })

   bindClick(container, ".rnt-heal-part", (ev) => {
      ev.preventDefault()
      const partId = getClosestItemId(ev.currentTarget)
      new HealBodyPartApp({ actor: app.actor, partId }).render(true)
   })

   bindClick(container, ".rnt-damage-part", (ev) => {
      ev.preventDefault()
      const partId = getClosestItemId(ev.currentTarget)
      new DamageBodyPartApp({
         actor: app.actor,
         partId,
         initialDamages: [],
      }).render(true)
   })

   bindClick(container, ".rnt-edit-part", (ev) => {
      ev.preventDefault()
      const partId = getClosestItemId(ev.currentTarget)
      new BodyPartApp({ actor: app.actor, partId }).render(true)
   })

   bindClick(container, ".rnt-copy-part", async (ev) => {
      ev.preventDefault()
      const partId = getClosestItemId(ev.currentTarget)
      const parts = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "parts") || [],
      )
      const originalIndex = parts.findIndex((p) => p.id === partId)
      if (originalIndex === -1) return

      const originalPart = parts[originalIndex]
      const baseNameMatch = originalPart.name.match(/^(.*?)(?: \(\d+\))?$/)
      const baseName = baseNameMatch ? baseNameMatch[1] : originalPart.name

      if (!originalPart.name.match(/\(\d+\)$/)) {
         originalPart.name = `${baseName} (1)`
      }

      const newPart = foundry.utils.deepClone(originalPart)
      newPart.id = foundry.utils.randomID()

      let suffixNum = 1
      let newName = `${baseName} (${suffixNum})`
      const existingNames = new Set(parts.map((p) => p.name))
      while (existingNames.has(newName)) {
         suffixNum++
         newName = `${baseName} (${suffixNum})`
      }

      newPart.name = newName
      parts.push(newPart)
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "parts", parts)
   })

   bindClick(container, ".rnt-delete-part", async (ev) => {
      ev.preventDefault()
      const partId = getClosestItemId(ev.currentTarget)
      const confirmed = await foundry.applications.api.DialogV2.confirm(
         withRntDialogTheme(
            {
               window: {
                  title: game.i18n.localize(`${MODULE_ID}.deleteBodyPartTitle`),
               },
               content: await renderDialogMessage(
                  game.i18n.localize(`${MODULE_ID}.deleteBodyPartPrompt`),
               ),
            },
            app.actor,
         ),
      )
      if (confirmed) {
         let parts = app.actor.getFlag(MODULE_ID, "parts") || []
         parts = parts.filter((p) => p.id !== partId)
         captureActorSheetScroll(app.actor)
         await app.actor.setFlag(MODULE_ID, "parts", parts)
      }
   })

   bindClick(container, ".rnt-item-row", (ev) => {
      if (
         ev.target.closest(".rnt-item-controls") ||
         ev.target.closest(".rnt-item-link-icons") ||
         ev.target.closest("a.content-link") ||
         ev.target.closest("input") ||
         ev.target.closest("button") ||
         ev.target.closest(".rnt-hp-block") ||
         ev.target.closest(".rnt-view-links") ||
         ev.target.closest(".rnt-linked-parts-icon")
      ) {
         return
      }
      ev.preventDefault()
      const item = ev.currentTarget.closest(".item")
      if (!item) return
      const itemId = getItemId(item)
      const summary = item.querySelector(".item-summary")
      if (!summary) return
      const isHidden = summary.hidden || summary.style.display === "none"
      if (isHidden) {
         summary.hidden = false
         summary.style.display = "block"
         window.RNT_EXPANDED.add(itemId)
      } else {
         summary.hidden = true
         summary.style.display = "none"
         window.RNT_EXPANDED.delete(itemId)
      }
   })

   container
      .find(".rnt-hp-input")
      .off("change")
      .on("change", async (ev) => {
         ev.preventDefault()
         const partId = ev.currentTarget.closest(".item").dataset.partId
         const newValue = parseInt(ev.currentTarget.value, 10)
         if (!isNaN(newValue)) {
            await setBodyPartHp(app.actor, partId, newValue, true)
         }
      })

   bindClick(container, ".rnt-view-links", (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const partId = ev.currentTarget.dataset.partId
      const linkType = ev.currentTarget.dataset.linkType
      import("../apps/linked-items-app.mjs").then((m) => {
         new m.LinkedItemsApp({ actor: app.actor, partId, linkType }).render(
            true,
         )
      })
   })

   bindClick(container, ".rnt-add-reaction", async (ev) => {
      ev.preventDefault()
      const reactions = app.actor.getFlag(MODULE_ID, "reactions") || []
      reactions.push({
         id: foundry.utils.randomID(),
         name: game.i18n.localize(`${MODULE_ID}.newDamageReaction`),
         minDamage: 0,
         reactTo: "both",
         allParts: true,
         specificParts: [],
         damageTypes: [],
         actionType: "reaction",
         sfxTrigger: "",
         triggers: [],
      })
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "reactions", reactions)
   })

   bindClick(container, ".rnt-edit-reaction", (ev) => {
      ev.preventDefault()
      const reactionId =
         ev.currentTarget.dataset.reactionId ||
         ev.currentTarget.closest(".item").dataset.reactionId
      new ReactionApp({ actor: app.actor, reactionId }).render(true)
   })

   bindClick(container, ".rnt-copy-reaction", async (ev) => {
      ev.preventDefault()
      const reactionId =
         ev.currentTarget.dataset.reactionId ||
         ev.currentTarget.closest(".item").dataset.reactionId
      const reactions = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "reactions") || [],
      )
      const originalIndex = reactions.findIndex((r) => r.id === reactionId)
      if (originalIndex === -1) return

      const newRx = foundry.utils.deepClone(reactions[originalIndex])
      newRx.id = foundry.utils.randomID()
      newRx.name = game.i18n.format(`${MODULE_ID}.copyName`, {
         name: newRx.name,
      })
      reactions.push(newRx)
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "reactions", reactions)
   })

   bindClick(container, ".rnt-delete-reaction", async (ev) => {
      ev.preventDefault()
      const reactionId =
         ev.currentTarget.dataset.reactionId ||
         ev.currentTarget.closest(".item").dataset.reactionId
      const confirmed = await foundry.applications.api.DialogV2.confirm(
         withRntDialogTheme(
            {
               window: {
                  title: game.i18n.localize(`${MODULE_ID}.deleteReactionTitle`),
               },
               content: await renderDialogMessage(
                  game.i18n.localize(`${MODULE_ID}.deleteReactionPrompt`),
               ),
            },
            app.actor,
         ),
      )
      if (confirmed) {
         let reactions = app.actor.getFlag(MODULE_ID, "reactions") || []
         reactions = reactions.filter((r) => r.id !== reactionId)
         captureActorSheetScroll(app.actor)
         await app.actor.setFlag(MODULE_ID, "reactions", reactions)
      }
   })

   bindClick(container, ".rnt-toggle-reaction", async (ev) => {
      ev.preventDefault()
      const reactionId =
         ev.currentTarget.dataset.reactionId ||
         ev.currentTarget.closest(".item").dataset.reactionId
      const reactions = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "reactions") || [],
      )
      const rx = reactions.find((r) => r.id === reactionId)
      if (rx) {
         rx.disabled = !rx.disabled
         captureActorSheetScroll(app.actor)
         await app.actor.setFlag(MODULE_ID, "reactions", reactions)
      }
   })

   bindClick(container, ".rnt-trigger-reaction", async (ev) => {
      ev.preventDefault()
      const reactionId =
         ev.currentTarget.dataset.reactionId ||
         ev.currentTarget.closest(".item").dataset.reactionId
      const reactions = app.actor.getFlag(MODULE_ID, "reactions") || []
      const rx = reactions.find((r) => r.id === reactionId)
      if (!rx) return
      if (rx.disabled) {
         ui.notifications.warn(
            game.i18n.localize(`${MODULE_ID}.reactionDisabledManual`),
         )
         return
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm(
         withRntDialogTheme(
            {
               window: {
                  title: game.i18n.format(`${MODULE_ID}.triggerReactionTitle`, {
                     name: rx.name,
                  }),
               },
               content: await renderDialogMessage(
                  game.i18n.format(`${MODULE_ID}.triggerReactionPrompt`, {
                     name: strongText(rx.name),
                  }),
               ),
            },
            app.actor,
         ),
      )
      if (confirmed) {
         const manualTarget = Array.from(game.user.targets)[0]?.document || null
         triggerReaction(app.actor, rx, manualTarget, { isManual: true })
      }
   })

   bindClick(container, ".rnt-add-death-reaction", async (ev) => {
      ev.preventDefault()
      const deathReaction = {
         id: foundry.utils.randomID(),
         name: game.i18n.localize(`${MODULE_ID}.newDeathReaction`),
         useDelay: false,
         delayRounds: 1,
         expiry: "turn-end",
         sfxTrigger: "",
         triggers: [],
      }
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "deathReaction", deathReaction)
   })

   bindClick(container, ".rnt-edit-death-reaction", (ev) => {
      ev.preventDefault()
      new DeathReactionApp({ actor: app.actor }).render(true)
   })

   bindClick(container, ".rnt-delete-death-reaction", async (ev) => {
      ev.preventDefault()
      const confirmed = await foundry.applications.api.DialogV2.confirm(
         withRntDialogTheme(
            {
               window: {
                  title: game.i18n.localize(`${MODULE_ID}.removeDeathReaction`),
               },
               content: await renderDialogMessage(
                  game.i18n.localize(`${MODULE_ID}.removeDeathReactionPrompt`),
               ),
            },
            app.actor,
         ),
      )
      if (confirmed) {
         captureActorSheetScroll(app.actor)
         await app.actor.unsetFlag(MODULE_ID, "deathReaction")
      }
   })

   bindClick(container, ".rnt-toggle-death-reaction", async (ev) => {
      ev.preventDefault()
      const deathReaction = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "deathReaction"),
      )
      if (deathReaction) {
         deathReaction.disabled = !deathReaction.disabled
         captureActorSheetScroll(app.actor)
         await app.actor.setFlag(MODULE_ID, "deathReaction", deathReaction)
      }
   })

   bindClick(container, ".rnt-trigger-death-reaction", async (ev) => {
      ev.preventDefault()
      const deathReaction = app.actor.getFlag(MODULE_ID, "deathReaction")
      if (!deathReaction) return
      if (deathReaction.disabled) {
         ui.notifications.warn(
            game.i18n.localize(`${MODULE_ID}.deathReactionDisabledManual`),
         )
         return
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm(
         withRntDialogTheme(
            {
               window: {
                  title: game.i18n.format(
                     `${MODULE_ID}.triggerDeathReactionTitle`,
                     { name: deathReaction.name },
                  ),
               },
               content: await renderDialogMessage(
                  game.i18n.format(`${MODULE_ID}.triggerReactionPrompt`, {
                     name: strongText(deathReaction.name),
                  }),
               ),
            },
            app.actor,
         ),
      )
      if (confirmed) {
         const manualTarget = Array.from(game.user.targets)[0]?.document || null
         triggerReaction(app.actor, deathReaction, manualTarget, {
            isManual: true,
            isDeath: true,
         })
      }
   })

   bindClick(container, ".rnt-export-part", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const id = ev.currentTarget.dataset.partId
      const parts = app.actor.getFlag(MODULE_ID, "parts") || []
      const part = parts.find((p) => p.id === id)
      if (!part) return
      const ie = await import("../import-export.mjs")
      ie.downloadJson(
         ie.buildElementExport("part", part),
         ie.safeFilename(`bodypart-${part.name}`),
      )
   })

   bindClick(container, ".rnt-export-reaction", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const id = ev.currentTarget.dataset.reactionId
      const reactions = app.actor.getFlag(MODULE_ID, "reactions") || []
      const rx = reactions.find((r) => r.id === id)
      if (!rx) return
      const ie = await import("../import-export.mjs")
      ie.downloadJson(
         ie.buildElementExport("reaction", rx),
         ie.safeFilename(`reaction-${rx.name}`),
      )
   })

   bindClick(container, ".rnt-export-death-reaction", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const dr = app.actor.getFlag(MODULE_ID, "deathReaction")
      if (!dr) return
      const ie = await import("../import-export.mjs")
      ie.downloadJson(
         ie.buildElementExport("deathReaction", dr),
         ie.safeFilename(`death-reaction-${dr.name || "unnamed"}`),
      )
   })

   bindClick(container, ".rnt-import-part", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const ie = await import("../import-export.mjs")
      const env = await ie.pickJsonFile()
      if (!env) return
      const valid = ie.validateEnvelope(env, ["part"])
      if (!valid) return
      const newPart = { ...valid.data, id: foundry.utils.randomID() }
      const parts = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "parts") || [],
      )
      parts.push(newPart)
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "parts", parts)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.importedItem`, { name: newPart.name }),
      )
   })

   bindClick(container, ".rnt-import-reaction", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const ie = await import("../import-export.mjs")
      const env = await ie.pickJsonFile()
      if (!env) return
      const valid = ie.validateEnvelope(env, ["reaction"])
      if (!valid) return
      const newRx = { ...valid.data, id: foundry.utils.randomID() }
      const reactions = foundry.utils.deepClone(
         app.actor.getFlag(MODULE_ID, "reactions") || [],
      )
      reactions.push(newRx)
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "reactions", reactions)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.importedItem`, { name: newRx.name }),
      )
   })

   bindClick(container, ".rnt-import-death-reaction", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const ie = await import("../import-export.mjs")
      const env = await ie.pickJsonFile()
      if (!env) return
      const valid = ie.validateEnvelope(env, ["deathReaction"])
      if (!valid) return
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "deathReaction", valid.data)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.importedItem`, {
            name:
               valid.data.name ||
               game.i18n.localize(`${MODULE_ID}.newDeathReaction`),
         }),
      )
   })

   bindClick(container, ".rnt-templates-menu", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const m = await import("../apps/templates-menu-app.mjs")
      new m.TemplatesMenuApp({ actor: app.actor }).render(true)
   })
}
