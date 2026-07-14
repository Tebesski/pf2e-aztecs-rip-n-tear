import {
   capitalizeDamageType,
   DAMAGE_COLOR_MAP,
   DAMAGE_ICON_MAP,
   localize,
   renderThresholdCardTemplate,
   stripDamageTags,
   TEMPLATE_BASE,
} from "./constants.mjs"

export async function renderCard({ formula, targetDocs, sourceActor, part }) {
   const name = part?.name || localize("thresholdDamage")
   return renderThresholdCardTemplate(`${TEMPLATE_BASE}/threshold-damage-card.hbs`, {
      name,
      headerIcon: await renderHeaderIcon(
         part?.img || sourceActor?.img || "icons/svg/d20.svg",
         name,
      ),
      formulaSummary: await renderFormulaSummary(
         formula,
         localize("thresholdDamageCardDamage"),
      ),
      targetRows: (
         await Promise.all(targetDocs.map((doc) => renderTargetRow(doc)))
      ).join(""),
   })
}

export async function renderFormulaSummary(formula, title) {
   return renderThresholdCardTemplate(
      `${TEMPLATE_BASE}/threshold-damage-formula-summary.hbs`,
      {
         title,
         rows: await renderFormulaSummaryRows(formula),
      },
   )
}

async function renderFormulaSummaryRows(formula) {
   const parts = splitFormulaParts(formula)
   if (parts.length === 0)
      return renderThresholdCardTemplate(
         `${TEMPLATE_BASE}/threshold-damage-formula-empty.hbs`,
         { formula: formula || "" },
      )

   return (
      await Promise.all(
         parts.map((part) => {
            const match = String(part).match(/^\s*(.*?)\s*(?:\[([^\]]+)\])?\s*$/)
            const cleanFormula = stripDamageTags(match?.[1] || part).trim()
            const tags = String(match?.[2] || "")
               .split(",")
               .map((tag) => tag.trim().toLowerCase())
               .filter(Boolean)
            const type = tags.find((tag) => DAMAGE_ICON_MAP[tag]) || "untyped"
            const icon = DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            const color = DAMAGE_COLOR_MAP[type] || DAMAGE_COLOR_MAP.untyped
            return renderThresholdCardTemplate(
               `${TEMPLATE_BASE}/threshold-damage-formula-row.hbs`,
               {
                  icon,
                  color,
                  formula: cleanFormula || part,
                  type,
               },
            )
         }),
      )
   ).join("")
}

function splitFormulaParts(formula) {
   const value = String(formula || "").trim()
   if (!value) return []
   const parts = []
   let current = ""
   let bracketDepth = 0
   for (let index = 0; index < value.length; index++) {
      const char = value[index]
      if (char === "[") bracketDepth++
      if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1)
      const isTopLevelSeparator =
         bracketDepth === 0 &&
         (char === "," ||
            (char === "+" &&
               /\s/.test(value[index - 1] || "") &&
               /\s/.test(value[index + 1] || "")))
      if (isTopLevelSeparator) {
         if (current.trim()) parts.push(current.trim())
         current = ""
         continue
      }
      current += char
   }
   if (current.trim()) parts.push(current.trim())
   return parts
}

function renderHeaderIcon(src, alt) {
   return renderThresholdCardTemplate(
      `${TEMPLATE_BASE}/threshold-damage-header-icon.hbs`,
      { src, alt },
   )
}

export async function renderRollBlock(rollData, title) {
   const instanceHtml = (
      await Promise.all(
         rollData.instances.map((instance) => {
            const type = instance.type || "untyped"
            const icon = DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            const color = DAMAGE_COLOR_MAP[type] || DAMAGE_COLOR_MAP.untyped
            return renderThresholdCardTemplate(
               `${TEMPLATE_BASE}/threshold-damage-roll-instance.hbs`,
               {
                  type,
                  label: capitalizeDamageType(type),
                  color,
                  formula: instance.formula || rollData.formula,
                  icon,
               },
            )
         }),
      )
   ).join("")
   return renderThresholdCardTemplate(
      `${TEMPLATE_BASE}/threshold-damage-roll-block.hbs`,
      {
         instances: instanceHtml,
         tooltip: await renderDiceTooltip(rollData),
         total: rollData.total,
         title,
      },
   )
}

export function renderTargetRow(targetDoc) {
   const actor = targetDoc.actor || targetDoc
   const name = actor?.name || targetDoc.name || ""
   return renderThresholdCardTemplate(
      `${TEMPLATE_BASE}/threshold-damage-target-row.hbs`,
      {
         uuid: targetDoc.uuid,
         name,
         applyLabel: localize("thresholdDamageCardApplyDamage"),
         halfLabel: localize("thresholdDamageCardHalf"),
         doubleLabel: localize("thresholdDamageCardDouble"),
      },
   )
}

async function renderDiceTooltip(rollData) {
   const parts = (
      await Promise.all(
         rollData.instances.map(async (instance) => {
            const type = instance.type || "untyped"
            const icon = DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            return renderThresholdCardTemplate(
               `${TEMPLATE_BASE}/threshold-damage-tooltip-part.hbs`,
               {
                  type,
                  label: capitalizeDamageType(type),
                  icon,
                  formula: instance.formula,
                  total: instance.total,
                  dice: await diceRollsForInstance(instance),
               },
            )
         }),
      )
   ).join("")
   return renderThresholdCardTemplate(`${TEMPLATE_BASE}/threshold-damage-tooltip.hbs`, {
      parts,
   })
}

async function diceRollsForInstance(instance) {
   return (
      await Promise.all(
         (instance.dice || []).map((die) => {
            const classes = ["roll", "die", `d${die.faces}`]
            if (die.value === 1) classes.push("min")
            if (die.value === die.faces) classes.push("max")
            return renderThresholdCardTemplate(
               `${TEMPLATE_BASE}/threshold-damage-die.hbs`,
               {
                  classes: classes.join(" "),
                  value: die.value,
               },
            )
         }),
      )
   ).join("")
}
