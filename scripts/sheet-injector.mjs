import { MODULE_ID, PF2E_VALUED_CONDITIONS } from "./constants.mjs"
import { BodyPartApp, DamageBodyPartApp } from "./apps/body-part-app.mjs"
import { HealBodyPartApp } from "./apps/heal-app.mjs"
import { ReactionApp } from "./apps/reaction-app.mjs"
import { DeathReactionApp } from "./apps/death-reaction-app.mjs"
import { setBodyPartHp } from "./mechanics.mjs"
import { triggerReaction } from "./reaction-mechanics.mjs"
import { getBodyPartHpColor, prepareBodyPartDisplay } from "./utils.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates`

window.RNT_EXPANDED = window.RNT_EXPANDED || new Set()
window.RNT_SCROLL_POS = window.RNT_SCROLL_POS || new Map()

if (!window.RNT_SCROLL_TRACKER_INSTALLED) {
   window.RNT_SCROLL_TRACKER_INSTALLED = true
   document.addEventListener(
      "scroll",
      (ev) => {
         const target = ev.target
         if (!target || target === document) return
         if (!target.classList) return
         const appEl = target.closest?.(
            ".app.sheet, .application.sheet, [data-rnt-actor-uuid]",
         )
         if (!appEl) return
         const actorUuid = appEl.dataset?.rntActorUuid
         if (!actorUuid) return
         const scrollKey = buildScrollKey(target, appEl)
         if (!scrollKey) return
         const map = window.RNT_SCROLL_POS.get(actorUuid) || new Map()
         map.set(scrollKey, target.scrollTop)
         window.RNT_SCROLL_POS.set(actorUuid, map)
      },
      true,
   )
}

function buildScrollKey(el, root) {
   const parts = []
   let cur = el
   while (cur && cur !== root && cur !== document) {
      const tag = cur.tagName?.toLowerCase() || ""
      const id = cur.id ? `#${cur.id}` : ""
      const cls = cur.classList?.length
         ? "." + Array.from(cur.classList).slice(0, 4).join(".")
         : ""
      const tab = cur.dataset?.tab ? `[data-tab="${cur.dataset.tab}"]` : ""
      parts.unshift(`${tag}${id}${cls}${tab}`)
      cur = cur.parentElement
   }
   return parts.join(" > ")
}

function resolveScrollKey(key, root) {
   const segments = key.split(" > ")
   let cur = root
   for (let i = 0; i < segments.length && cur; i++) {
      if (i === 0) continue
      const sel = segments[i]
      let match = null
      try {
         match = cur.querySelector(":scope > " + sel)
      } catch (_e) {}
      if (!match) {
         try {
            match = cur.querySelector(sel)
         } catch (_e) {
            return null
         }
      }
      if (!match) return null
      cur = match
   }
   return cur === root ? null : cur
}

function restoreActorScrollPositions(actorUuid, rootEl) {
   const map = window.RNT_SCROLL_POS.get(actorUuid)
   if (!map || !rootEl) return
   let attempts = 0
   const restore = () => {
      if (!rootEl.isConnected) return
      for (const [key, top] of map.entries()) {
         if (typeof top !== "number" || top <= 0) continue
         const el = resolveScrollKey(key, rootEl)
         if (el && Math.abs(el.scrollTop - top) > 1) {
            el.scrollTop = top
         }
      }
      attempts++
      if (attempts < 24) requestAnimationFrame(restore)
   }
   restore()
   setTimeout(restore, 50)
   setTimeout(restore, 150)
   setTimeout(restore, 350)
   setTimeout(restore, 700)
   setTimeout(restore, 1200)
}

export function captureActorSheetScroll(actor) {
   if (!actor) return
   const sheets = Object.values(ui.windows).filter(
      (w) => w.actor === actor && typeof w.appId === "number",
   )
   const v2Apps = []
   try {
      for (const a of foundry.applications?.instances?.values?.() || []) {
         if (a?.actor === actor) v2Apps.push(a)
      }
   } catch (_e) {}
   const allSheets = [...sheets, ...v2Apps]
   for (const sheet of allSheets) {
      if (!sheet.element) continue
      const root =
         sheet.element instanceof HTMLElement ? sheet.element : sheet.element[0]
      if (!root) continue
      root.dataset.rntActorUuid = actor.uuid
      const map = window.RNT_SCROLL_POS.get(actor.uuid) || new Map()
      const scrollables = root.querySelectorAll(
         ".sheet-body, .window-content, .tab.active, .tab-content, .scroll-container, [data-tab].active, .actor-main-content",
      )
      for (const el of scrollables) {
         if (el.scrollTop > 0) {
            map.set(buildScrollKey(el, root), el.scrollTop)
         }
      }
      window.RNT_SCROLL_POS.set(actor.uuid, map)
   }
}

function getItemId(el) {
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

export function injectRipAndTearSection(app, html, data) {
   if (app.actor) {
      const $appRoot = html.closest(".app, .application")
      if ($appRoot.length) {
         $appRoot[0].dataset.rntActorUuid = app.actor.uuid
         restoreActorScrollPositions(app.actor.uuid, $appRoot[0])
      }
   }

   if (app.actor.type !== "npc") return

   if (!app.rntDeleteHooked && app.element && app.element[0]) {
      app.element[0].addEventListener(
         "click",
         async (ev) => {
            const target = ev.target.closest('[data-action="delete-item"]')
            if (!target) return

            const itemRow = target.closest(".item")
            if (!itemRow) return

            const itemId = itemRow.dataset.itemId
            const item = app.actor.items.get(itemId)

            if (item && item.getFlag(MODULE_ID, "isBodyPartEffect")) {
               ev.preventDefault()
               ev.stopPropagation()
               const partName =
                  item.getFlag(MODULE_ID, "bodyPartName") ||
                  game.i18n.localize(`${MODULE_ID}.unknownItem`)
               const partId = item.getFlag(MODULE_ID, "partId")

               const choice = await foundry.applications.api.DialogV2.wait({
                  window: {
                     title: game.i18n.localize(
                        `${MODULE_ID}.lockedEffectTitle`,
                     ),
                  },
                  content: `<p>${game.i18n.format(`${MODULE_ID}.lockedEffectChoiceContent`, { partName })}</p>`,
                  buttons: [
                     {
                        action: "heal",
                        icon: "fa-solid fa-heart-circle-plus",
                        label: game.i18n.localize(`${MODULE_ID}.healBodyPart`),
                     },
                     {
                        action: "remove",
                        icon: "fa-solid fa-trash",
                        label: game.i18n.localize(`${MODULE_ID}.removeEffect`),
                     },
                     {
                        action: "cancel",
                        icon: "fa-solid fa-xmark",
                        label: game.i18n.localize(`${MODULE_ID}.cancel`),
                     },
                  ],
                  default: "cancel",
               })

               if (choice === "heal") {
                  if (!partId) return
                  new HealBodyPartApp({
                     actor: app.actor,
                     partId,
                  }).render(true)
               } else if (choice === "remove") {
                  item.delete()
               }
            }
         },
         true,
      )
      app.rntDeleteHooked = true
   }

   const parts = app.actor.getFlag(MODULE_ID, "parts") || []
   const reactions = foundry.utils.deepClone(
      app.actor.getFlag(MODULE_ID, "reactions") || [],
   )
   const deathReaction = foundry.utils.deepClone(
      app.actor.getFlag(MODULE_ID, "deathReaction") || null,
   )

   const TRIG_ICON = {
      damage: "fa-heart-crack",
      "saving-throw": "fa-dice-d20",
      effect: "fa-suitcase",
      condition: "fa-circle-exclamation",
      macro: "fa-code",
   }
   const decorateTrigger = (t) => {
      const typeKey =
         t.type === "saving-throw"
            ? "savingThrow"
            : t.type === "damage"
              ? "dealDamage"
              : t.type === "effect"
                ? "typeEffect"
                : t.type === "condition"
                  ? "typeCondition"
                  : t.type === "macro"
                    ? "executeMacro"
                    : "trigger"
      const targetKey =
         t.target === "self"
            ? "self"
            : t.target === "aura"
              ? "aura"
              : "triggerer"
      const filterKey =
         t.targetFilters === "allies"
            ? "affectsAllies"
            : t.targetFilters === "all"
              ? "affectsAll"
              : "affectsEnemies"
      t.iconClass = TRIG_ICON[t.type] || "fa-bolt"
      t.typeLabel = game.i18n.localize(`${MODULE_ID}.${typeKey}`)
      t.targetLabel = game.i18n.localize(`${MODULE_ID}.${targetKey}`)
      t.targetFiltersLabel = game.i18n.localize(`${MODULE_ID}.${filterKey}`)
      if (t.saveType) {
         t.saveTypeLabel = game.i18n.localize(`${MODULE_ID}.${t.saveType}`)
      }
      if (t.type === "condition") {
         t.hasValue = PF2E_VALUED_CONDITIONS.includes(t.slug)
      }
      return t
   }

   const formatStr = (str) => {
      if (!str) return ""
      return str
         .split(",")
         .map((s) =>
            s
               .trim()
               .split(" ")
               .map((w) =>
                  w
                     .split("-")
                     .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                     .join(" "),
               )
               .join(" "),
         )
         .join(", ")
   }

   const processedParts = parts.map((p) => {
      const displayData = prepareBodyPartDisplay(p, app.actor)

      let immStr = "",
         immExcStr = ""
      let wkStr = "",
         wkExcStr = ""
      let resStr = "",
         resExcStr = ""

      if (p.customIWR && p.iwr) {
         immStr = formatStr(p.iwr.immune)
         immExcStr = formatStr(p.iwr.immuneExc)
         wkStr = formatStr(p.iwr.weak)
         wkExcStr = formatStr(p.iwr.weakExc)
         resStr = formatStr(p.iwr.resist)
         resExcStr = formatStr(p.iwr.resistExc)
      } else {
         const mapSys = (list) => {
            if (!list) return { m: "", e: "" }
            const ms = [],
               es = []
            for (const x of list) {
               ms.push(x.type + (x.value ? ` ${x.value}` : ""))
               if (x.exceptions) es.push(...x.exceptions)
            }
            return { m: formatStr(ms.join(", ")), e: formatStr(es.join(", ")) }
         }
         const i = mapSys(app.actor.system.attributes.immunities)
         immStr = i.m
         immExcStr = i.e
         const w = mapSys(app.actor.system.attributes.weaknesses)
         wkStr = w.m
         wkExcStr = w.e
         const r = mapSys(app.actor.system.attributes.resistances)
         resStr = r.m
         resExcStr = r.e
      }

      const decorated = {
         ...p,
         hasSpellcastingLinks:
            p.linkedEntries?.length > 0 ||
            p.linkedSpells?.length > 0 ||
            p.linkedItems?.includes("ALL_SPELLCASTING"),
         hasAbilityLinks:
            p.linkedItems?.filter((id) => id !== "ALL_SPELLCASTING").length > 0,
         hpText: displayData.hpDisplay,
         hpColor: getBodyPartHpColor(p),
         iwrImmune: immStr,
         iwrImmuneExc: immExcStr,
         iwrWeak: wkStr,
         iwrWeakExc: wkExcStr,
         iwrResist: resStr,
         iwrResistExc: resExcStr,
         hasIwr: !!(immStr || wkStr || resStr),
      }
      if (decorated.thresholds) {
         decorated.thresholds = decorated.thresholds.map((t) => ({
            ...t,
            conditions: (t.conditions || []).map((c) => ({
               ...c,
               hasValue: PF2E_VALUED_CONDITIONS.includes(c.slug),
            })),
            linkedPartsData: (t.linkedParts || []).map((lpId) => {
               const lp = parts.find((x) => x.id === lpId)
               return lp ? { id: lpId, name: lp.name } : { id: lpId, name: "?" }
            }),
         }))
      }
      return decorated
   })

   for (const rx of reactions) {
      if (rx.triggers) rx.triggers = rx.triggers.map(decorateTrigger)
   }
   if (deathReaction?.triggers) {
      deathReaction.triggers = deathReaction.triggers.map(decorateTrigger)
   }

   ;(async () => {
      try {
         const renderTpl = foundry.applications.handlebars.renderTemplate
         for (const p of processedParts) {
            p.summaryHtml = await renderTpl(
               `${TEMPLATE_BASE}/part-summary.hbs`,
               p,
            )
         }
         for (const rx of reactions) {
            rx.summaryHtml = await renderTpl(
               `${TEMPLATE_BASE}/reaction-summary.hbs`,
               rx,
            )
         }
         if (deathReaction) {
            deathReaction.summaryHtml = await renderTpl(
               `${TEMPLATE_BASE}/death-reaction-summary.hbs`,
               deathReaction,
            )
         }

         const markup = await renderTpl(
            `${TEMPLATE_BASE}/npc-sheet-section.hbs`,
            {
               actor: app.actor,
               parts: processedParts,
               reactions,
               deathReaction,
            },
         )
         const $appRoot = html.closest(".app, .application")
         if ($appRoot.length) {
            $appRoot[0].dataset.rntActorUuid = app.actor.uuid
         }

         const existingContainer = html.find(".rip-n-tear-container")
         if (existingContainer.length) {
            existingContainer.replaceWith(markup)
         } else {
            const passivesSection = html.find(
               '[data-tab="main"] .passives.section-container',
            )
            if (passivesSection.length) passivesSection.after(markup)
         }

         const newContainer = html.find(".rip-n-tear-container")

         newContainer.find(".item").each((i, el) => {
            const id = getItemId(el)
            if (window.RNT_EXPANDED.has(id)) {
               const summary = el.querySelector(".item-summary")
               if (summary) {
                  summary.hidden = false
                  summary.style.display = "block"
               }
            }
         })

         restoreActorScrollPositions(app.actor.uuid, $appRoot[0])

         activateRipAndTearListeners(app, newContainer)
         updateLinkedAbilitiesDisplay(app, html, parts)
      } catch (err) {
         console.error("Rip & Tear | Error rendering sheet section", err)
      }
   })()
}

function bindClick(container, selector, handler) {
   container.find(selector).off("click").on("click", handler)
}

function activateRipAndTearListeners(app, container) {
   bindClick(container, ".rnt-add-part", async (ev) => {
      ev.preventDefault()
      const parts = app.actor.getFlag(MODULE_ID, "parts") || []
      const baseHp =
         app.actor.system.attributes?.hp?.max ??
         app.actor.attributes?.hp?.max ??
         10
      const partHp = Math.max(1, Math.floor(baseHp * 0.1))
      const actorHardness = app.actor.system.attributes?.hardness?.value || 0

      parts.push({
         id: foundry.utils.randomID(),
         name: "New Body Part",
         img: "icons/commodities/biological/organ-heart-pink.webp",
         hp: { value: partHp, max: partHp },
         ac: app.actor.attributes.ac.value + 2,
         hardness: actorHardness,
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
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         window: { title: "Delete Body Part" },
         content: `<p>Are you sure you want to remove this body part entirely?</p>`,
      })
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
      import("./apps/linked-items-app.mjs").then((m) => {
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
         name: "New Damage Reaction",
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
      newRx.name = `${newRx.name} (Copy)`
      reactions.push(newRx)
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "reactions", reactions)
   })

   bindClick(container, ".rnt-delete-reaction", async (ev) => {
      ev.preventDefault()
      const reactionId =
         ev.currentTarget.dataset.reactionId ||
         ev.currentTarget.closest(".item").dataset.reactionId
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         window: { title: "Delete Reaction" },
         content: `<p>Are you sure you want to remove this damage reaction?</p>`,
      })
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
         ui.notifications.warn("Cannot manually trigger a disabled reaction.")
         return
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         window: { title: `Trigger Reaction: ${rx.name}?` },
         content: `<p>Are you sure you want to manually trigger the <strong>${rx.name}</strong> reaction?</p>`,
      })
      if (confirmed) {
         const manualTarget = Array.from(game.user.targets)[0]?.document || null
         triggerReaction(app.actor, rx, manualTarget, { isManual: true })
      }
   })

   bindClick(container, ".rnt-add-death-reaction", async (ev) => {
      ev.preventDefault()
      const deathReaction = {
         id: foundry.utils.randomID(),
         name: "New Death Reaction",
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
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         window: {
            title: game.i18n.localize(`${MODULE_ID}.removeDeathReaction`),
         },
         content: `<p>${game.i18n.localize(`${MODULE_ID}.removeDeathReactionPrompt`)}</p>`,
      })
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
            "Cannot manually trigger a disabled death reaction.",
         )
         return
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         window: { title: `Trigger Death Reaction: ${deathReaction.name}?` },
         content: `<p>Are you sure you want to manually trigger the <strong>${deathReaction.name}</strong> reaction?</p>`,
      })
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
      const ie = await import("./import-export.mjs")
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
      const ie = await import("./import-export.mjs")
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
      const ie = await import("./import-export.mjs")
      ie.downloadJson(
         ie.buildElementExport("deathReaction", dr),
         ie.safeFilename(`death-reaction-${dr.name || "unnamed"}`),
      )
   })

   bindClick(container, ".rnt-import-part", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const ie = await import("./import-export.mjs")
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
      const ie = await import("./import-export.mjs")
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
      const ie = await import("./import-export.mjs")
      const env = await ie.pickJsonFile()
      if (!env) return
      const valid = ie.validateEnvelope(env, ["deathReaction"])
      if (!valid) return
      captureActorSheetScroll(app.actor)
      await app.actor.setFlag(MODULE_ID, "deathReaction", valid.data)
      ui.notifications.info(
         game.i18n.format(`${MODULE_ID}.importedItem`, {
            name: valid.data.name || "Death Reaction",
         }),
      )
   })

   bindClick(container, ".rnt-templates-menu", async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      const m = await import("./apps/templates-menu-app.mjs")
      new m.TemplatesMenuApp({ actor: app.actor }).render(true)
   })
}

export function updateLinkedAbilitiesDisplay(app, html, parts) {
   const abilityMap = new Map()

   parts.forEach((part) => {
      let isDisabled = false
      let hasMatchingThreshold = false

      if (part.thresholds && part.thresholds.length > 0) {
         const ascendingThresholds = [...part.thresholds].sort(
            (a, b) => a.hpValue - b.hpValue,
         )
         for (const t of ascendingThresholds) {
            if (part.hp.value <= t.hpValue) {
               hasMatchingThreshold = true
               let conditionMet = true
               if (t.linkedParts && t.linkedParts.length > 0) {
                  for (const lpId of t.linkedParts) {
                     const lp = parts.find((x) => x.id === lpId)
                     if (!lp || lp.hp.value > t.hpValue) {
                        conditionMet = false
                        break
                     }
                  }
               }
               if (conditionMet) {
                  if (t.disableAbilities) isDisabled = true
                  break
               }
            }
         }
      }

      if (!hasMatchingThreshold && part.hp.value <= 0) {
         isDisabled = true
      }

      const addLink = (id) => {
         if (id === "ALL_SPELLCASTING") return
         if (!abilityMap.has(id))
            abilityMap.set(id, { parts: [], allDisabled: true })
         const entry = abilityMap.get(id)
         entry.parts.push({
            id: part.id,
            name: part.name,
            hp: part.hp.value,
            max: part.hp.max,
         })
         if (!isDisabled) entry.allDisabled = false
      }

      if (part.linkedItems) {
         part.linkedItems.forEach(addLink)
         if (part.linkedItems.includes("ALL_SPELLCASTING")) {
            const noEntries =
               !part.linkedEntries || part.linkedEntries.length === 0
            const noSpells =
               !part.linkedSpells || part.linkedSpells.length === 0
            if (noEntries && noSpells) {
               app.actor.itemTypes.spellcastingEntry.forEach((e) =>
                  addLink(e.id),
               )
               app.actor.itemTypes.spell.forEach((s) => addLink(s.id))
            }
         }
      }

      if (part.linkedEntries) part.linkedEntries.forEach(addLink)
      if (part.linkedSpells) part.linkedSpells.forEach(addLink)
   })

   abilityMap.forEach((data, itemId) => {
      const itemRow = html.find(`[data-item-id="${itemId}"]`)
      if (!itemRow.length) return

      const isEntry = itemRow.hasClass("spellcasting-entry")
      const isSpell = itemRow.hasClass("spell")

      let targetHeader
      if (isEntry) {
         targetHeader = itemRow.children(".header").find("h4.name").first()
      } else if (isSpell) {
         targetHeader = itemRow.find(".item-name h4.name").first()
      } else {
         const h4s = itemRow.find("h4")
         targetHeader = itemRow.children(".header").length
            ? itemRow.children(".header").find("h4.name").first()
            : h4s.first()
      }

      const iconClass = data.allDisabled
         ? "fa-solid fa-bone-break"
         : "fa-solid fa-link"
      let textStyle
      if (data.allDisabled) {
         textStyle = "color: #a00;"
      } else if (isEntry) {
         textStyle = "color: rgb(247, 243, 232);"
      } else {
         textStyle = "color: var(--text-dark);"
      }

      const itemNameEsc = (
         itemRow.find(".item-name h4, h4.name").first().text() || ""
      )
         .trim()
         .replace(/"/g, "&quot;")
      const linkLabel = game.i18n.localize(`${MODULE_ID}.bodyPartsLinkLabel`)
      const linkTip = game.i18n.localize(`${MODULE_ID}.bodyPartsLinkTooltip`)
      const linksHtml = `<a class="rnt-linked-parts-icon" data-item-id="${itemId}" data-item-name="${itemNameEsc}" data-tooltip="${linkTip}" style="margin-left: 8px; cursor: pointer; font-size: 0.85em; font-weight: normal; ${textStyle}"><i class="${iconClass}"></i> ${linkLabel}</a>`

      const traitsSpan = targetHeader.find(".traits")
      if (traitsSpan.length) {
         traitsSpan.after(linksHtml)
      } else {
         targetHeader.append(linksHtml)
      }

      if (data.allDisabled) {
         itemRow[0].addEventListener(
            "click",
            (ev) => {
               if (
                  ev.target.closest('[data-action="toggle-summary"]') ||
                  ev.target.closest('[data-action="edit-item"]') ||
                  ev.target.closest('[data-action="delete-item"]') ||
                  ev.target.closest(".rnt-linked-parts-icon")
               )
                  return

               const isCast =
                  ev.target.closest(".cast-spell") ||
                  ev.target.closest(".item-image") ||
                  isEntry ||
                  isSpell ||
                  ev.target.closest(".attack-button") ||
                  ev.target.closest('[data-action="strike-damage"]') ||
                  ev.target.closest('[data-action="strike-critical"]')
               if (isCast) {
                  ev.stopImmediatePropagation()
                  ev.stopPropagation()
                  ev.preventDefault()
                  const partNames = data.parts.map((p) => p.name).join(", ")
                  ui.notifications.warn(
                     game.i18n.format(`${MODULE_ID}.abilityDisabled`, {
                        partName: partNames,
                     }),
                  )
               }
            },
            true,
         )
      }
   })

   html
      .find(".rnt-linked-parts-icon")
      .off("click")
      .on("click", async (ev) => {
         ev.stopPropagation()
         ev.preventDefault()
         const itemId = ev.currentTarget.dataset.itemId
         const itemName = ev.currentTarget.dataset.itemName
         const m = await import("./apps/ability-linked-parts-app.mjs")
         new m.AbilityLinkedPartsApp({
            actor: app.actor,
            itemId,
            itemName,
         }).render(true)
      })
}
