import { stripDamageTags } from "./constants.mjs"

export async function applyCardDamage({
   targetUuid,
   damage,
   multiplier = 1,
} = {}) {
   const target = await fromUuid(targetUuid).catch(() => null)
   const actor = target?.actor || (target?.documentName === "Actor" ? target : null)
   if (!actor || !damage) return false

   const token =
      target?.object ||
      globalThis.canvas?.tokens?.get?.(target.id) ||
      actor.getActiveTokens?.()[0] ||
      null
   let roll = null
   try {
      roll = Roll.fromData(JSON.parse(damage.rollJSON))
   } catch (_err) {
      roll = null
   }

   const scale = Number(multiplier) || 1
   const total = Math.max(0, Math.floor((Number(damage.total) || 0) * scale))

   if (roll && actor.applyDamage) {
      scaleRollTotal(roll, scale, total)
      await actor.applyDamage({ damage: roll, token })
      return true
   }

   if (actor.applyDamage) {
      await actor.applyDamage({ damage: total, token })
      return true
   }

   const hpPath = "system.attributes.hp.value"
   const hp = Number(foundry.utils.getProperty(actor, hpPath)) || 0
   await actor.update({ [hpPath]: Math.max(0, hp - total) })
   return true
}

export function scaleRollTotal(roll, scale, total) {
   try {
      Object.defineProperty(roll, "_total", {
         value: total,
         configurable: true,
         writable: true,
      })
   } catch (_err) {
      roll._total = total
   }

   for (const instance of roll.instances || []) {
      const instanceTotal = Math.max(
         0,
         Math.floor((Number(instance.total) || 0) * scale),
      )
      try {
         Object.defineProperty(instance, "_total", {
            value: instanceTotal,
            configurable: true,
            writable: true,
         })
      } catch (_err) {
         instance._total = instanceTotal
      }
   }
}

export async function rollFormula(formula) {
   const RollCls =
      CONFIG?.Dice?.rolls?.find?.((cls) => cls.name === "DamageRoll") ||
      globalThis.DamageRoll ||
      Roll
   let roll = null
   try {
      roll = await new RollCls(formula).evaluate({
         allowInteractive: false,
      })
   } catch (err) {
      if (RollCls === Roll) throw err
      roll = await new Roll(stripDamageTags(formula)).evaluate({
         allowInteractive: false,
      })
   }
   return rollData(roll, formula)
}

export function rollData(roll, formula) {
   const instances = Array.isArray(roll.instances)
      ? roll.instances.map((instance, index) => ({
           formula:
              instance.head?.expression ||
              String(instance.formula || formula).replace(/\[[^\]]+\]/g, ""),
           type: instance.type || instance.damageType || "untyped",
           total: Number(instance.total) || 0,
           dice: diceResultsForInstance(instance, roll, index),
        }))
      : []

   if (instances.length === 0)
      instances.push({
         formula,
         type: "untyped",
         total: Number(roll.total) || 0,
         dice: diceResultsForInstance(null, roll, 0),
      })

   return {
      formula,
      total: Number(roll.total) || 0,
      rollJSON: JSON.stringify(roll.toJSON()),
      tooltipHTML: "",
      instances,
   }
}

export function diceResultsForInstance(instance, roll, index) {
   const diceSource =
      instance?.dice ||
      instance?.head?.dice ||
      (roll?.dice?.[index] && [roll.dice[index]]) ||
      []
   return Array.from(diceSource).flatMap((die) => {
      const faces = Number(die.faces) || Number(die.number) || 20
      return Array.from(die.results || []).map((result) => ({
         faces,
         value: Number(result.result ?? result.value ?? 0) || 0,
      }))
   })
}

export function damageFormula(entries = []) {
   return (
      entries
         .map((entry) => damageTerm(entry))
         .filter(Boolean)
         .join(" + ") || "0"
   )
}

function damageTerm(entry = {}) {
   const diceNum = Math.max(0, parseInt(entry.diceNum) || 0)
   const step = String(entry.diceStep || "").trim()
   if (diceNum <= 0) return ""
   const base = step ? `${diceNum}d${step}` : `${diceNum}`

   const type = String(entry.dmgType || "untyped").trim() || "untyped"
   const category = String(entry.dmgCategory || "").trim()
   const tags =
      type === "bleed"
         ? ["persistent", "bleed"]
         : category === "persistent"
           ? ["persistent", type]
           : category
             ? [category, type]
             : [type]
   return `${base}[${tags.join(",")}]`
}
