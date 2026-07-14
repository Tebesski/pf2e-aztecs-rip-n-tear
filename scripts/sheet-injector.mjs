import { MODULE_ID, PF2E_VALUED_CONDITIONS } from "./constants.mjs"
import { HealBodyPartApp } from "./apps/heal-app.mjs"
import { getBodyPartHpColor, prepareBodyPartDisplay } from "./utils.mjs"
import {
   applyRntThemeClass,
   getActorIwrList,
   isRntSupportedActor,
   isSiegeVehicleActor,
   isSiegeComponentAction,
   syncRntDisabledModules,
} from "./actor-support.mjs"
import { promptLockedEffectChoice } from "./dialogs/locked-effect-dialog.mjs"
import { restoreActorScrollPositions } from "./sheet/scroll.mjs"
export { captureActorSheetScroll } from "./sheet/scroll.mjs"
import { activateRipAndTearListeners, getItemId } from "./sheet/listeners.mjs"
import { updateLinkedAbilitiesDisplay } from "./sheet/linked-display.mjs"
export { updateLinkedAbilitiesDisplay } from "./sheet/linked-display.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates`

const TRIGGER_ICON = {
   damage: "fa-heart-crack",
   "saving-throw": "fa-dice-d20",
   effect: "fa-suitcase",
   condition: "fa-circle-exclamation",
   macro: "fa-code",
}

function decorateReactionTrigger(trigger) {
   const typeKey =
      trigger.type === "saving-throw"
         ? "savingThrow"
         : trigger.type === "damage"
           ? "dealDamage"
           : trigger.type === "effect"
             ? "typeEffect"
             : trigger.type === "condition"
               ? "typeCondition"
               : trigger.type === "macro"
                 ? "executeMacro"
                 : "trigger"
   const targetKey =
      trigger.target === "self"
         ? "self"
         : trigger.target === "aura"
           ? "aura"
           : "triggerer"
   const filterKey =
      trigger.targetFilters === "allies"
         ? "affectsAllies"
         : trigger.targetFilters === "all"
           ? "affectsAll"
           : "affectsEnemies"
   trigger.iconClass = TRIGGER_ICON[trigger.type] || "fa-bolt"
   trigger.typeLabel = game.i18n.localize(`${MODULE_ID}.${typeKey}`)
   trigger.targetLabel = game.i18n.localize(`${MODULE_ID}.${targetKey}`)
   trigger.targetFiltersLabel = game.i18n.localize(`${MODULE_ID}.${filterKey}`)
   if (trigger.saveType) {
      trigger.saveTypeLabel = game.i18n.localize(
         `${MODULE_ID}.${trigger.saveType}`,
      )
   }
   if (trigger.type === "condition") {
      trigger.hasValue = PF2E_VALUED_CONDITIONS.includes(trigger.slug)
   }
   return trigger
}

function formatSummaryList(str) {
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

export async function buildRntSheetData(actor, options = {}) {
   const isSiegeVehicle =
      options.isSiegeVehicle ?? isSiegeVehicleActor(actor)
   const rawParts = actor?.getFlag(MODULE_ID, "parts") || []
   const reactions = foundry.utils.deepClone(
      actor?.getFlag(MODULE_ID, "reactions") || [],
   )
   const deathReaction = foundry.utils.deepClone(
      actor?.getFlag(MODULE_ID, "deathReaction") || null,
   )

   const processedParts = rawParts.map((p) => {
      const displayData = prepareBodyPartDisplay(p, actor)

      let immStr = "",
         immExcStr = ""
      let wkStr = "",
         wkExcStr = ""
      let resStr = "",
         resExcStr = ""

      if (p.customIWR && p.iwr) {
         immStr = formatSummaryList(p.iwr.immune)
         immExcStr = formatSummaryList(p.iwr.immuneExc)
         wkStr = formatSummaryList(p.iwr.weak)
         wkExcStr = formatSummaryList(p.iwr.weakExc)
         resStr = formatSummaryList(p.iwr.resist)
         resExcStr = formatSummaryList(p.iwr.resistExc)
      } else {
         const mapSys = (list) => {
            if (!list) return { m: "", e: "" }
            const ms = [],
               es = []
            for (const x of list) {
               ms.push(x.type + (x.value ? ` ${x.value}` : ""))
               if (x.exceptions) es.push(...x.exceptions)
            }
            return {
               m: formatSummaryList(ms.join(", ")),
               e: formatSummaryList(es.join(", ")),
            }
         }
         const i = mapSys(getActorIwrList(actor, "immunities"))
         immStr = i.m
         immExcStr = i.e
         const w = mapSys(getActorIwrList(actor, "weaknesses"))
         wkStr = w.m
         wkExcStr = w.e
         const r = mapSys(getActorIwrList(actor, "resistances"))
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
            p.linkedItems?.filter(
               (id) =>
                  id !== "ALL_SPELLCASTING" &&
                  !isSiegeComponentAction(actor.items?.get?.(id)),
            ).length > 0,
         hasModuleLinks: isSiegeVehicle && p.linkedModules?.length > 0,
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
               const lp = rawParts.find((x) => x.id === lpId)
               return lp ? { id: lpId, name: lp.name } : { id: lpId, name: "?" }
            }),
         }))
      }
      return decorated
   })

   for (const rx of reactions) {
      if (rx.triggers) rx.triggers = rx.triggers.map(decorateReactionTrigger)
   }
   if (deathReaction?.triggers) {
      deathReaction.triggers =
         deathReaction.triggers.map(decorateReactionTrigger)
   }

   const renderTpl = foundry.applications.handlebars.renderTemplate
   for (const p of processedParts) {
      p.summaryHtml = await renderTpl(`${TEMPLATE_BASE}/part-summary.hbs`, p)
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

   return {
      actor,
      parts: processedParts,
      reactions,
      deathReaction,
      isSiegeVehicle,
      themeClass: options.themeClass || "",
   }
}

export function injectRipAndTearSection(app, html, _data, options = {}) {
   if (app.actor) {
      const $appRoot = html.closest(".app, .application")
      if ($appRoot.length) {
         $appRoot[0].dataset.rntActorUuid = app.actor.uuid
         applyRntThemeClass($appRoot[0], app.actor)
         restoreActorScrollPositions(app.actor.uuid, $appRoot[0])
      }
   }

   if (!isRntSupportedActor(app.actor)) return
   const isSiegeVehicle = isSiegeVehicleActor(app.actor)
   if (isSiegeVehicle && options.mode !== "vehicle-tab") return

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

               const choice = await promptLockedEffectChoice(app.actor, partName)

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

   ;(async () => {
      try {
         const renderTpl = foundry.applications.handlebars.renderTemplate
         const sheetData = await buildRntSheetData(app.actor, {
            isSiegeVehicle,
            themeClass: options.themeClass || "",
         })

         const markup = await renderTpl(
            `${TEMPLATE_BASE}/npc-sheet-section.hbs`,
            sheetData,
         )
         const $appRoot = html.closest(".app, .application")
         if ($appRoot.length) {
            $appRoot[0].dataset.rntActorUuid = app.actor.uuid
         }

         const target = options.target
         if (target?.length) {
            target.html(markup)
         } else {
            const existingContainer = html.find(".rip-n-tear-container")
            if (existingContainer.length) {
               existingContainer.replaceWith(markup)
            } else {
               const passivesSection = html.find(
                  '[data-tab="main"] .passives.section-container',
               )
               if (passivesSection.length) passivesSection.after(markup)
            }
         }

         const newContainer = target?.length
            ? target.find(".rip-n-tear-container")
            : html.find(".rip-n-tear-container")

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
         await updateLinkedAbilitiesDisplay(app, html, parts)
         if (isSiegeVehicle) await syncRntDisabledModules(app.actor, parts)
      } catch (_err) {
      }
   })()
}

export async function injectRipAndTearVehicleTab(app, html, actor = app.actor) {
   if (!isSiegeVehicleActor(actor)) return

   const renderTpl = foundry.applications.handlebars.renderTemplate
   const title = game.i18n.localize(`${MODULE_ID}.title`)
   const nav = html.find("nav.sheet-navigation, nav").first()
   if (!html.find('a[data-tab="rip-and-tear"]').length) {
      const tabLink = $(
         await renderTpl(`${TEMPLATE_BASE}/sheet/vehicle-tab-link.hbs`, {
            title,
         }),
      )
      const sfxLink = html.find('a[data-tab="sfx"]').last()
      const descriptionLink = html.find('a[data-tab="description"]').last()
      if (sfxLink.length) sfxLink.after(tabLink)
      else if (descriptionLink.length) descriptionLink.before(tabLink)
      else nav.append(tabLink)
   }

   if (!html.find('.tab[data-tab="rip-and-tear"]').length) {
      const tabBody = $(
         await renderTpl(`${TEMPLATE_BASE}/sheet/vehicle-tab-body.hbs`, {}),
      )
      const descriptionTab = html.find('.tab[data-tab="description"]').first()
      if (descriptionTab.length) descriptionTab.before(tabBody)
      else html.find(".sheet-content").append(tabBody)
   }

   const tab = html.find('.tab[data-tab="rip-and-tear"]').first()
   injectRipAndTearSection(app, html, null, {
      mode: "vehicle-tab",
      target: tab,
      themeClass: "rnt-siege-theme",
   })
}

function normalizeHtmlElement(html, app) {
   if (html instanceof HTMLElement) return html
   if (html?.[0] instanceof HTMLElement) return html[0]
   if (app?.element instanceof HTMLElement) return app.element
   if (app?.element?.[0] instanceof HTMLElement) return app.element[0]
   return null
}

function getVehicleHudActor(app) {
   return app?.vehicle || app?.actor || app?.document || null
}

function hasRntHudStatusData(actor) {
   return !!(
      actor?.getFlag(MODULE_ID, "parts")?.length ||
      actor?.getFlag(MODULE_ID, "reactions")?.length ||
      actor?.getFlag(MODULE_ID, "deathReaction")
   )
}

function activateVehicleHudStatusListeners(root) {
   root
      .querySelectorAll("[data-action='toggle-rnt-hud-status']")
      .forEach((button) => {
         button.addEventListener("click", (ev) => {
            ev.preventDefault()
            const acc = button.closest(".rnt-vehicle-hud-status")
            const body = acc?.querySelector(".rnt-vehicle-hud-status-body")
            const icon = button.querySelector("i")
            if (!body || !icon) return
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : ""
            acc.classList.toggle("open", !open)
            icon.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

   root.querySelectorAll(".rnt-hud-entry-head").forEach((button) => {
      button.addEventListener("click", (ev) => {
         ev.preventDefault()
         const entry = button.closest(".rnt-hud-entry")
         const body = entry?.querySelector(".rnt-hud-entry-body")
         const icon = button.querySelector(".rnt-hud-entry-toggle i")
         if (!body || !icon) return
         const open = !body.hidden && body.style.display !== "none"
         body.hidden = open
         body.style.display = open ? "none" : "block"
         entry.classList.toggle("open", !open)
         icon.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
      })
   })
}

export function injectRipAndTearVehicleHudStatus(app, html) {
   const actor = getVehicleHudActor(app)
   if (!isSiegeVehicleActor(actor) || !hasRntHudStatusData(actor)) return

   const root = normalizeHtmlElement(html, app)
   if (!root?.querySelector?.(".siege-vehicle-hud")) return
   const detailsActive =
      app?.tab === "details" ||
      !!root.querySelector('.vh-tab.active[data-tab="details"]')
   if (!detailsActive) return

   const statsCol = root.querySelector(".vh-stats-col")
   if (!statsCol) return

   ;(async () => {
      try {
         const data = await buildRntSheetData(actor, {
            isSiegeVehicle: true,
            themeClass: "rnt-siege-theme",
         })
         if (
            !data.parts.length &&
            !data.reactions.length &&
            !data.deathReaction
         )
            return

         const markup =
            await foundry.applications.handlebars.renderTemplate(
               `${TEMPLATE_BASE}/vehicle-hud-status.hbs`,
               data,
            )
         const wrapper = document.createElement("div")
         wrapper.innerHTML = markup.trim()
         const status = wrapper.firstElementChild
         if (!status) return

         statsCol.querySelector(".rnt-vehicle-hud-status")?.remove()
         const weaponry = statsCol.querySelector(".vh-weapon-acc")
         if (weaponry) weaponry.replaceWith(status)
         else statsCol.appendChild(status)

         activateVehicleHudStatusListeners(status)
      } catch (err) {
      }
   })()
}

export function refreshRipAndTearVehicleHudStatus(actor) {
   if (!isSiegeVehicleActor(actor)) return
   const apps = []
   try {
      apps.push(...(foundry.applications?.instances?.values?.() || []))
   } catch (_err) {}
   try {
      apps.push(...Object.values(ui.windows || {}))
   } catch (_err) {}

   for (const app of new Set(apps)) {
      const vehicle = getVehicleHudActor(app)
      if (vehicle !== actor && vehicle?.uuid !== actor.uuid) continue
      const root = normalizeHtmlElement(null, app)
      if (!root?.querySelector?.(".siege-vehicle-hud")) continue
      if (typeof app.render === "function") {
         app.render({ force: false })
      }
   }
}
