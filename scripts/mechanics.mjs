import { MODULE_ID } from "./constants.mjs"
import { playSfx } from "./sfx.mjs"
import {
   getActorHpValue,
   getActorIwrList,
} from "./actor-support.mjs"
import { formatHpState } from "./mechanics/hp-display.mjs"
import { checkIWRMatch, parseIWRString } from "./mechanics/iwr.mjs"
import { createParentEffectsData } from "./mechanics/threshold-effects-data.mjs"
import { processThresholdState } from "./mechanics/threshold-state.mjs"
import { strongText } from "./html-format.mjs"

export { resolveSfxPath } from "./sfx.mjs"
export { createParentEffectsData, parseIWRString }

async function playPartChangeSfx(part, isDamage, isManual = false) {
   const muteManual = game.settings.get(MODULE_ID, "muteManualHpSfx")
   if (isManual && muteManual) return

   if (!isDamage) {
      if (part.sfxHeal) await playSfx(part.sfxHeal, "heal")
      return
   }
   if (part.hp.value <= 0 && part.sfxDestroy) {
      await playSfx(part.sfxDestroy, "destroy")
   } else if (part.sfxDamage) {
      await playSfx(part.sfxDamage, "damage")
   }
}

async function removePersistentEffectsForPart(actor, partId) {
   const persistentEffects = actor.items.filter(
      (i) =>
         i.getFlag(MODULE_ID, "isPersistent") &&
         i.getFlag(MODULE_ID, "persistentData")?.partId === partId,
   )
   if (persistentEffects.length > 0) {
      await actor.deleteEmbeddedDocuments(
         "Item",
         persistentEffects.map((e) => e.id),
      )
   }
}

export async function setBodyPartHp(actor, partId, newHp, isManual = false) {
   const parts = foundry.utils.deepClone(
      actor.getFlag(MODULE_ID, "parts") || [],
   )
   const part = parts.find((p) => p.id === partId)
   if (!part) return

   const previousHp = part.hp.value
   part.hp.value = Math.clamp(newHp, 0, part.hp.max)

   if (part.hp.value <= 0 && previousHp > 0) {
      await removePersistentEffectsForPart(actor, part.id)
   }

   if (part.hp.value < previousHp) {
      await playPartChangeSfx(part, true, isManual)
      if (!isManual) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(`${MODULE_ID}.chatDamageReport`, {
               partName: part.name,
               amount: previousHp - part.hp.value,
               hpState: formatHpState(part),
            }),
         })
      }
   } else if (part.hp.value > previousHp) {
      await playPartChangeSfx(part, false, isManual)
      if (!isManual) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(`${MODULE_ID}.chatHealReport`, {
               partName: part.name,
               amount: part.hp.value - previousHp,
               hpState: formatHpState(part),
            }),
         })
      }
   }

   await processThresholdState(actor, part, parts)
   for (const otherPart of parts) {
      if (otherPart.id === part.id) continue
      const linksToMe = otherPart.thresholds?.some((t) =>
         t.linkedParts?.includes(part.id),
      )
      if (linksToMe) await processThresholdState(actor, otherPart, parts)
   }
}

export async function applyBodyPartDamage(
   actor,
   partId,
   amount,
   dmgType,
   dmgCategory,
   ignoreHardAmount = 0,
   ignoreAllHard = false,
   rollOptions = new Set(),
   options = {},
) {
   const suppressChat = options.suppressChat === true

   if (!amount || amount <= 0) {
      return
   }

   const parts = foundry.utils.deepClone(
      actor.getFlag(MODULE_ID, "parts") || [],
   )
   const part = parts.find((p) => p.id === partId)
   if (!part) {
      return
   }


   if (dmgCategory === "persistent") {
      const effectData = {
         name: game.i18n.format(`${MODULE_ID}.persistentDamageEffectName`, {
            damageType: dmgType,
            partName: part.name,
         }),
         type: "effect",
         img: "systems/pf2e/icons/conditions/persistent-damage.webp",
         system: {
            description: {
               value: game.i18n.format(
                  `${MODULE_ID}.persistentDamageEffectDescription`,
                  { amount, damageType: dmgType },
               ),
            },
         },
         flags: {
            [MODULE_ID]: {
               isPersistent: true,
               persistentData: { partId, amount, dmgType },
            },
         },
      }
      await actor.createEmbeddedDocuments("Item", [effectData])
      if (!suppressChat) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(`${MODULE_ID}.bodyPartPersistentDamage`, {
               partName: strongText(part.name),
               amount,
               damageType: dmgType,
            }),
         })
      }
      return
   }

   if (dmgCategory === "persistent-tick") dmgCategory = "persistent"

   const acceptedTypes = Array.isArray(part.acceptedDmgTypes)
      ? part.acceptedDmgTypes.filter((t) => t)
      : []
   if (
      acceptedTypes.length > 0 &&
      dmgType &&
      !acceptedTypes.includes(dmgType)
   ) {
      if (!suppressChat) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(`${MODULE_ID}.bodyPartIgnoredDamageType`, {
               partName: strongText(part.name),
               amount,
               damageType: dmgType,
            }),
            whisper: ChatMessage.getWhisperRecipients("GM"),
         })
      }
      return
   }

   let finalAmount = amount

   const immuneList = part.customIWR
      ? parseIWRString(part.iwr?.immune)
      : getActorIwrList(actor, "immunities")
   const weakList = part.customIWR
      ? parseIWRString(part.iwr?.weak)
      : getActorIwrList(actor, "weaknesses")
   const resistList = part.customIWR
      ? parseIWRString(part.iwr?.resist)
      : getActorIwrList(actor, "resistances")

   const immuneExcList = part.customIWR
      ? (part.iwr?.immuneExc || "")
           .split(",")
           .map((s) => s.trim())
           .filter((s) => s)
      : []
   const weakExcList = part.customIWR
      ? (part.iwr?.weakExc || "")
           .split(",")
           .map((s) => s.trim())
           .filter((s) => s)
      : []
   const resistExcList = part.customIWR
      ? (part.iwr?.resistExc || "")
           .split(",")
           .map((s) => s.trim())
           .filter((s) => s)
      : []

   if (dmgType) {
      if (
         immuneList.some((i) =>
            checkIWRMatch(
               i.type,
               dmgType,
               rollOptions,
               i.exceptions,
               immuneExcList,
            ),
         )
      ) {
         finalAmount = 0
      } else {
         const weaknesses = weakList.filter((w) =>
            checkIWRMatch(
               w.type,
               dmgType,
               rollOptions,
               w.exceptions,
               weakExcList,
            ),
         )
         if (weaknesses.length > 0) {
            finalAmount += Math.max(...weaknesses.map((w) => w.value))
         }
         const resistances = resistList.filter((r) =>
            checkIWRMatch(
               r.type,
               dmgType,
               rollOptions,
               r.exceptions,
               resistExcList,
            ),
         )
         if (resistances.length > 0) {
            const highest = Math.max(...resistances.map((r) => r.value))
            finalAmount = Math.max(0, finalAmount - highest)
         }
      }
   }

   let effectiveHardness = part.hardness || 0
   if (ignoreAllHard) effectiveHardness = 0
   else if (ignoreHardAmount > 0)
      effectiveHardness = Math.max(0, effectiveHardness - ignoreHardAmount)

   const preHardnessAmount = finalAmount
   finalAmount = Math.max(0, finalAmount - effectiveHardness)
   const absorbed = preHardnessAmount - finalAmount

   if (absorbed > 0) {
      const hardnessMsg =
         finalAmount === 0
            ? game.i18n.format(`${MODULE_ID}.bodyPartAbsorbedAllHardness`, {
                 partName: strongText(part.name),
              })
            : game.i18n.format(`${MODULE_ID}.bodyPartAbsorbedSomeHardness`, {
                 partName: strongText(part.name),
                 finalAmount,
                 preHardnessAmount,
                 absorbed,
              })
      if (!suppressChat) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: hardnessMsg,
            whisper: ChatMessage.getWhisperRecipients("GM"),
         })
      }
   }

   const previousHp = part.hp.value
   let chatReport = ""
   let failedRupture = false

   if (part.useRupture) {
      if (finalAmount >= part.hp.max) {
         part.hp.value = 0
         chatReport = game.i18n.format(`${MODULE_ID}.bodyPartRuptured`, {
            partName: strongText(part.name),
            amount: finalAmount,
         })
      } else {
         failedRupture = true
         chatReport = game.i18n.format(`${MODULE_ID}.bodyPartNotRuptured`, {
            partName: strongText(part.name),
            amount: finalAmount,
         })
      }
   } else {
      part.hp.value = Math.max(0, part.hp.value - finalAmount)
      chatReport = game.i18n.format(`${MODULE_ID}.chatDamageReport`, {
         partName: part.name,
         amount: finalAmount,
         hpState: formatHpState(part),
      })
   }

   if (part.hp.value <= 0 && previousHp > 0) {
      await removePersistentEffectsForPart(actor, part.id)
   }

   if (part.dealsDamage) {
      const skipPersistent =
         dmgCategory === "persistent" && !part.persistentDealsDamage
      const skipFailedRupture = failedRupture && !part.failedRuptureDealsDamage
      if (!skipPersistent && !skipFailedRupture) {
         const creatureDamage = Math.floor(finalAmount * part.multiplier)
         const currentActorHp = getActorHpValue(actor)
         await actor.update(
            {
               "system.attributes.hp.value": Math.max(
                  0,
                  currentActorHp - creatureDamage,
               ),
            },
            {
               rntDamageSource: "part",
               rntPartId: partId,
               rntOriginalPartDamage: finalAmount,
               rntDmgType: dmgType,
            },
         )

         if (!suppressChat) {
            ChatMessage.create({
               speaker: ChatMessage.getSpeaker({ actor }),
               content: game.i18n.format(
                  `${MODULE_ID}.chatCreatureDamageReport`,
                  {
                     actorName: actor.name,
                     amount: creatureDamage,
                     partName: part.name,
                  },
               ),
            })
         }
      }
   } else if (finalAmount > 0 && !failedRupture) {
      import("./reaction-mechanics.mjs").then((m) => {
         m.evaluateReactions(
            actor,
            finalAmount,
            new Set(dmgType ? [dmgType] : []),
            "part",
            partId,
         )
      })
   }

   if (part.hp.value < previousHp || failedRupture) {
      if (part.hp.value < previousHp) {
         await playPartChangeSfx(part, true)
      }
      if (!suppressChat) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: chatReport,
         })
      }
   }


   await processThresholdState(actor, part, parts)

   if (
      finalAmount > 0 &&
      part.disableRegenDmgTypes &&
      part.disableRegenDmgTypes.includes(dmgType)
   ) {
      const dVal = part.disableRegenDurationValue || 1
      const dUnit = part.disableRegenDurationUnit || "rounds"
      const effectData = {
         name: game.i18n.format(`${MODULE_ID}.regenerationDisabledEffectName`, {
            partName: part.name,
         }),
         type: "effect",
         img: "icons/magic/life/heart-broken-red.webp",
         system: {
            description: {
               value: game.i18n.localize(
                  `${MODULE_ID}.regenerationDisabledEffectDescription`,
               ),
            },
            duration:
               dUnit !== "unlimited"
                  ? { value: dVal, unit: dUnit, expiry: "turn-end" }
                  : { value: -1, unit: "unlimited" },
            rules: [
               {
                  key: "AELike",
                  mode: "override",
                  path: "system.attributes.hp.regeneration.suppressed",
                  value: true,
                  priority: 99,
               },
               {
                  key: "AELike",
                  mode: "override",
                  path: "system.attributes.hp.fastHealing",
                  value: null,
                  priority: 99,
               },
            ],
         },
         flags: { [MODULE_ID]: { isRegenDisabled: true, partId: part.id } },
      }
      await actor.createEmbeddedDocuments("Item", [effectData])
      if (!suppressChat) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(
               `${MODULE_ID}.bodyPartRegenerationDisabled`,
               {
                  partName: strongText(part.name),
                  damageType: dmgType,
               },
            ),
         })
      }
   }

   for (const otherPart of parts) {
      if (otherPart.id === part.id) continue
      const linksToMe = otherPart.thresholds?.some((t) =>
         t.linkedParts?.includes(part.id),
      )
      if (linksToMe) await processThresholdState(actor, otherPart, parts)
   }
}

export async function applyBodyPartHealing(actor, partId, amount, options = {}) {
   if (!amount || amount <= 0) return

   const parts = foundry.utils.deepClone(
      actor.getFlag(MODULE_ID, "parts") || [],
   )
   const part = parts.find((p) => p.id === partId)
   if (!part) return

   const previousHp = part.hp.value
   part.hp.value = Math.min(part.hp.max, part.hp.value + amount)

   if (part.hp.value > previousHp) {
      await playPartChangeSfx(part, false)
      if (!options.suppressChat) {
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(`${MODULE_ID}.chatHealReport`, {
               partName: part.name,
               amount: part.hp.value - previousHp,
               hpState: formatHpState(part),
            }),
         })
      }
   }

   await processThresholdState(actor, part, parts)
   for (const otherPart of parts) {
      if (otherPart.id === part.id) continue
      const linksToMe = otherPart.thresholds?.some((t) =>
         t.linkedParts?.includes(part.id),
      )
      if (linksToMe) await processThresholdState(actor, otherPart, parts)
   }
}
