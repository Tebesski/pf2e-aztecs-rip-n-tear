import { MODULE_ID } from "../constants.mjs"
import { applyBodyPartDamage } from "../mechanics.mjs"

export function getTargetDoc(tokenRef) {
   if (!tokenRef) return null
   if (typeof tokenRef === "string") return fromUuidSync(tokenRef)
   return tokenRef.document || tokenRef
}

export function targetRefsMatch(left, right) {
   if (!left || !right) return false
   if (left === right) return true
   if (left === right?.uuid || left?.uuid === right) return true

   const leftDoc = getTargetDoc(left)
   const rightDoc = getTargetDoc(right)
   if (!leftDoc || !rightDoc) return false
   if (leftDoc.uuid && rightDoc.uuid && leftDoc.uuid === rightDoc.uuid)
      return true

   const leftActorUuid =
      leftDoc.actor?.uuid ||
      (leftDoc.documentName === "Actor" ? leftDoc.uuid : null)
   const rightActorUuid =
      rightDoc.actor?.uuid ||
      (rightDoc.documentName === "Actor" ? rightDoc.uuid : null)
   if (leftActorUuid && rightActorUuid && leftActorUuid === rightActorUuid)
      return true

   if (
      leftDoc.actor?.uuid &&
      rightDoc.actor?.uuid &&
      leftDoc.actor.uuid === rightDoc.actor.uuid
   )
      return true
   if (
      leftDoc.actor?.id &&
      rightDoc.actor?.id &&
      leftDoc.actor.id === rightDoc.actor.id
   )
      return true
   return false
}

export function getApplyButtonTargetUuid(button, message) {
   const row = button.closest(".target-row")
   const actorUuid =
      button.dataset.actorUuid ||
      row?.dataset?.actorUuid ||
      message.flags?.pf2e?.context?.target?.actor ||
      null
   return (
      button.dataset.targetUuid ||
      button.dataset.tokenUuid ||
      row?.dataset?.targetUuid ||
      row?.dataset?.tokenUuid ||
      row?.querySelector(".damage-application")?.dataset?.targetUuid ||
      message.getFlag(MODULE_ID, "targetUuid") ||
      message.flags?.pf2e?.context?.target?.token ||
      message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets?.[0] ||
      actorUuid ||
      Array.from(game.user.targets)[0]?.document?.uuid ||
      null
   )
}

export async function applyCalledShotDamageFromMessage(message, button) {
   const partId = message.getFlag(MODULE_ID, "calledShotPartId")
   if (!partId) {
      return false
   }

   const targetUuid = getApplyButtonTargetUuid(button, message)
   const targetDoc = getTargetDoc(targetUuid)
   const actor = targetDoc?.actor ?? (targetDoc?.type ? targetDoc : null)
   if (!actor) {
      return false
   }

   const parts = actor.getFlag(MODULE_ID, "parts") || []
   const part = parts.find((p) => p.id === partId)
   if (!part) {
      return false
   }

   const { damages, rollOptions } = extractDamageFromMessage(message)
   if (!damages.length) {
      ui.notifications.warn(
         game.i18n.localize(`${MODULE_ID}.noValidDamageInRoll`),
      )
      return true
   }

   const rollOptionsSet = new Set(rollOptions)
   for (const damage of damages) {
      let amount = damage.amount
      if (
         typeof amount === "string" &&
         amount.includes("d") &&
         damage.category !== "persistent"
      ) {
         amount = (await new Roll(amount).evaluate()).total
      }

      await applyBodyPartDamage(
         actor,
         partId,
         amount,
         damage.dmgType,
         damage.category,
         0,
         false,
         rollOptionsSet,
      )
   }

   return true
}

function categorizeDamageInstance(inst, isSplashRoll) {
   let dmgType = inst.type || "untyped"
   const instOpts = inst.options ? Array.from(inst.options) : []
   let dmgCategory = inst.category || ""

   if (dmgType === "untyped") {
      const typeOpt = instOpts.find((o) => o.startsWith("item:damage:type:"))
      if (typeOpt) dmgType = typeOpt.split(":").pop()
   }

   if (
      inst.category === "splash" ||
      instOpts.includes("splash") ||
      instOpts.includes("trait:splash") ||
      isSplashRoll
   ) {
      dmgCategory = "splash"
   } else if (
      inst.persistent ||
      inst.category === "persistent" ||
      instOpts.includes("persistent") ||
      instOpts.includes("trait:persistent") ||
      dmgType === "bleed" ||
      (typeof dmgType === "string" && dmgType.includes("persistent"))
   ) {
      dmgCategory = "persistent"
   } else if (
      inst.category === "precision" ||
      instOpts.includes("precision") ||
      instOpts.includes("trait:precision")
   ) {
      dmgCategory = "precision"
   }

   if (typeof dmgType === "string" && dmgType.includes("persistent")) {
      dmgType =
         dmgType.replace("persistent", "").replace(",", "").trim() || "untyped"
   }

   return { dmgType, dmgCategory }
}

function resolvePersistentAmount(inst) {
   const formula =
      inst.expression ||
      inst.head?.expression ||
      inst.formula ||
      inst._formula ||
      ""
   if (!formula || typeof formula !== "string") return formula
   if (!formula.includes("d")) {
      return parseInt(formula, 10) || formula
   }
   return formula
}

export function extractDamageFromMessage(message) {
   const damages = []
   let totalDamage = 0
   const rolls = message.rolls || []

   const rollOptions = new Set(message.flags?.pf2e?.context?.options || [])
   const content = message.content || message.flavor || ""

   const materialMatches = content.matchAll(/data-material="([^"]+)"/g)
   for (const m of materialMatches) rollOptions.add(`item:material:${m[1]}`)
   const traitMatches = content.matchAll(/data-trait="([^"]+)"/g)
   for (const m of traitMatches) rollOptions.add(`item:trait:${m[1]}`)

   for (let r of rolls) {
      if (typeof r === "string") {
         try {
            r = Roll.fromJSON(r)
         } catch (e) {
            continue
         }
      }

      const rollOpts = r.options ? Array.from(r.options) : []
      rollOpts.forEach((o) => rollOptions.add(o))

      const isSplashRoll =
         rollOpts.includes("splash") ||
         rollOpts.includes("trait:splash") ||
         r.options?.flavor === "splash"

      const instances = r.instances || [r]
      for (const inst of instances) {
         let amount = inst.total || 0
         const { dmgType, dmgCategory } = categorizeDamageInstance(
            inst,
            isSplashRoll,
         )

         if (dmgCategory === "persistent" && amount === 0) {
            if (typeof resolvePersistentAmount === "function") {
               amount = resolvePersistentAmount(inst)
            }
         }

         if (
            amount === 0 ||
            amount === "" ||
            amount === null ||
            Number.isNaN(amount)
         )
            continue

         damages.push({ amount, dmgType, category: dmgCategory })
         if (typeof amount === "number" && dmgCategory !== "persistent") {
            totalDamage += amount
         }
      }
   }
   return { damages, totalDamage, rollOptions: Array.from(rollOptions) }
}

export function collectDamageTypesFromMessage(message) {
   const types = new Set()
   const optsArray = message.flags?.pf2e?.context?.options || []
   const options = optsArray instanceof Set ? Array.from(optsArray) : optsArray
   const typeOpt = options.find((o) => o.startsWith("item:damage:type:"))
   if (typeOpt) types.add(typeOpt.split(":").pop())

   const rolls = message.rolls || []
   for (const r of rolls) {
      let rollObj = r
      if (typeof r === "string") {
         try {
            rollObj = Roll.fromJSON(r)
         } catch (e) {
            continue
         }
      }
      const instances = rollObj.instances || [rollObj]
      for (const inst of instances) {
         if (inst.type) types.add(inst.type)
      }
   }
   return types
}
