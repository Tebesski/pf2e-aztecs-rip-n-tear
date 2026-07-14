import { MODULE_ID } from "../constants.mjs"
import { getActorItemsByType, isSiegeComponentAction } from "../actor-support.mjs"

const TEMPLATE_BASE = `modules/${MODULE_ID}/templates/sheet`

export async function updateLinkedAbilitiesDisplay(app, html, parts) {
   const renderTpl = foundry.applications.handlebars.renderTemplate
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
         if (isSiegeComponentAction(app.actor.items?.get?.(id))) return
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
               getActorItemsByType(app.actor, "spellcastingEntry").forEach((e) =>
                  addLink(e.id),
               )
               getActorItemsByType(app.actor, "spell").forEach((s) =>
                  addLink(s.id),
               )
            }
         }
      }

      if (part.linkedEntries) part.linkedEntries.forEach(addLink)
      if (part.linkedSpells) part.linkedSpells.forEach(addLink)
   })

   for (const [itemId, data] of abilityMap) {
      const itemRow = html.find(`[data-item-id="${itemId}"]`)
      if (!itemRow.length) continue

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

      const itemName = (
         itemRow.find(".item-name h4, h4.name").first().text() || ""
      ).trim()
      const linkLabel = game.i18n.localize(`${MODULE_ID}.bodyPartsLinkLabel`)
      const linkTip = game.i18n.localize(`${MODULE_ID}.bodyPartsLinkTooltip`)
      const linksHtml = await renderTpl(
         `${TEMPLATE_BASE}/linked-parts-icon.hbs`,
         {
            iconClass,
            itemId,
            itemName,
            label: linkLabel,
            style: textStyle,
            tooltip: linkTip,
         },
      )

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
   }

   html
      .find(".rnt-linked-parts-icon")
      .off("click")
      .on("click", async (ev) => {
         ev.stopPropagation()
         ev.preventDefault()
         const itemId = ev.currentTarget.dataset.itemId
         const itemName = ev.currentTarget.dataset.itemName
         const m = await import("../apps/ability-linked-parts-app.mjs")
         new m.AbilityLinkedPartsApp({
            actor: app.actor,
            itemId,
            itemName,
         }).render(true)
      })
}
