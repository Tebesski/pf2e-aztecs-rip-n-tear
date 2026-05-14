import { MODULE_ID } from "./constants.mjs"
import { prepareBodyPartDisplay } from "./utils.mjs"
import { playSfx } from "./sfx.mjs"

export { resolveSfxPath } from "./sfx.mjs"

export function parseIWRString(str) {
   if (!str || typeof str !== "string") return []
   return str
      .split(",")
      .map((s) => {
         const parts = s.trim().toLowerCase().split(" ")
         return { type: parts[0], value: parseInt(parts[1]) || 0 }
      })
      .filter((x) => x.type)
}

const PHYSICAL_TYPES = ["bludgeoning", "piercing", "slashing", "bleed"]
const ENERGY_TYPES = [
   "acid",
   "cold",
   "electricity",
   "fire",
   "sonic",
   "force",
   "vitality",
   "void",
   "positive",
   "negative",
]

function checkIWRMatch(iwrType, dmgType) {
   if (!iwrType || !dmgType) return false
   const iwr = iwrType.toLowerCase()
   const dmg = dmgType.toLowerCase()
   if (iwr === dmg) return true
   if (iwr === "all-damage" || iwr === "all") return true
   if (iwr === "physical" && PHYSICAL_TYPES.includes(dmg)) return true
   if (iwr === "energy" && ENERGY_TYPES.includes(dmg)) return true
   return false
}

export function createParentEffectData(part, threshold) {
   const rules = []

   if (threshold.conditions) {
      for (const cond of threshold.conditions) {
         const conditionBase = game.pf2e.ConditionManager.getCondition(
            cond.slug,
         )
         if (!conditionBase) continue
         const rule = {
            key: "GrantItem",
            uuid: conditionBase.sourceId || conditionBase.uuid,
            onDeleteActions: { grantee: "restrict" },
         }
         if (cond.hasValue || cond.value > 1) {
            rule.alterations = [
               {
                  property: "badge-value",
                  mode: "override",
                  value: cond.value,
               },
            ]
         }
         rules.push(rule)
      }
   }

   if (threshold.effects) {
      for (const ef of threshold.effects) {
         if (ef.uuid && !ef.invalid) {
            rules.push({
               key: "GrantItem",
               uuid: ef.uuid,
               onDeleteActions: { grantee: "restrict" },
            })
         }
      }
   }

   if (threshold.ruleElements) {
      for (const re of threshold.ruleElements) {
         if (!re.invalid && re.json && re.json.trim() !== "") {
            try {
               rules.push(JSON.parse(re.json))
            } catch (e) {}
         }
      }
   }

   const descValue =
      threshold.customDescription && threshold.customDescription.trim() !== ""
         ? threshold.customDescription
         : `<p>Effects applied because <strong>${part.name}</strong> reached ${threshold.hpValue} HP or lower.</p>`

   return {
      name: `${part.name} Damaged`,
      type: "effect",
      img: "icons/svg/blood.svg",
      system: {
         description: { value: descValue },
         rules,
      },
      flags: {
         [MODULE_ID]: {
            isBodyPartEffect: true,
            bodyPartName: part.name,
            partId: part.id,
         },
      },
   }
}

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

function formatHpState(part) {
   const displayData = prepareBodyPartDisplay(part, null, true)
   let display = displayData.hpDisplay || ""
   if (display.startsWith("HP: ")) display = display.replace("HP: ", "").trim()
   return display
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
) {
   if (!amount || amount <= 0) return

   const parts = foundry.utils.deepClone(
      actor.getFlag(MODULE_ID, "parts") || [],
   )
   const part = parts.find((p) => p.id === partId)
   if (!part) return

   if (dmgCategory === "persistent") {
      const effectData = {
         name: `Persistent ${dmgType} (${part.name})`,
         type: "effect",
         img: "systems/pf2e/icons/conditions/persistent-damage.webp",
         system: {
            description: {
               value: `Takes ${amount} persistent ${dmgType} damage.`,
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
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: `<strong>${part.name}</strong> was afflicted with ${amount} Persistent ${dmgType} damage.`,
      })
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
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: `<strong>${part.name}</strong> ignored ${amount} ${dmgType} damage (does not accept this damage type).`,
         whisper: ChatMessage.getWhisperRecipients("GM"),
      })
      return
   }

   let finalAmount = amount

   const immuneList = part.customIWR
      ? parseIWRString(part.iwr?.immune)
      : actor.system.attributes.immunities || []
   const weakList = part.customIWR
      ? parseIWRString(part.iwr?.weak)
      : actor.system.attributes.weaknesses || []
   const resistList = part.customIWR
      ? parseIWRString(part.iwr?.resist)
      : actor.system.attributes.resistances || []

   if (dmgType) {
      if (immuneList.some((i) => checkIWRMatch(i.type, dmgType))) {
         finalAmount = 0
      } else {
         const weaknesses = weakList.filter((w) =>
            checkIWRMatch(w.type, dmgType),
         )
         if (weaknesses.length > 0) {
            finalAmount += Math.max(...weaknesses.map((w) => w.value))
         }
         const resistances = resistList.filter((r) =>
            checkIWRMatch(r.type, dmgType),
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
            ? `<strong>${part.name}</strong> absorbed all of the damage with Hardness.`
            : `<strong>${part.name}</strong> took ${finalAmount} damage (received ${preHardnessAmount} damage, absorbed ${absorbed} damage with Hardness).`
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: hardnessMsg,
         whisper: ChatMessage.getWhisperRecipients("GM"),
      })
   }

   const previousHp = part.hp.value
   let chatReport = ""
   let failedRupture = false

   if (part.useRupture) {
      if (finalAmount >= part.hp.max) {
         part.hp.value = 0
         chatReport = `<strong>${part.name}</strong> took ${finalAmount} damage and was <strong>Ruptured</strong>!`
      } else {
         failedRupture = true
         chatReport = `<strong>${part.name}</strong> received ${finalAmount} damage and was not Ruptured!`
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
         const currentActorHp = actor.system.attributes.hp.value
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

         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(`${MODULE_ID}.chatCreatureDamageReport`, {
               actorName: actor.name,
               amount: creatureDamage,
               partName: part.name,
            }),
         })
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
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: chatReport,
      })
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

export async function applyBodyPartHealing(actor, partId, amount) {
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
      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor }),
         content: game.i18n.format(`${MODULE_ID}.chatHealReport`, {
            partName: part.name,
            amount: part.hp.value - previousHp,
            hpState: formatHpState(part),
         }),
      })
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

async function processThresholdState(actor, part, parts) {
   if (!part.thresholds || part.thresholds.length === 0) {
      await actor.setFlag(MODULE_ID, "parts", parts)
      return
   }

   let activeThreshold = null
   let activeIndex = -1
   const ascendingThresholds = part.thresholds
      .map((t, i) => ({ ...t, originalIndex: i }))
      .sort((a, b) => a.hpValue - b.hpValue)

   for (const t of ascendingThresholds) {
      let conditionMet = part.hp.value <= t.hpValue
      if (conditionMet && t.linkedParts && t.linkedParts.length > 0) {
         for (const lpId of t.linkedParts) {
            const lp = parts.find((x) => x.id === lpId)
            if (!lp || lp.hp.value > t.hpValue) {
               conditionMet = false
               break
            }
         }
      }
      if (conditionMet) {
         activeThreshold = t
         activeIndex = t.originalIndex
         break
      }
   }

   const existingParents = actor.items.filter(
      (i) =>
         i.getFlag(MODULE_ID, "isBodyPartEffect") &&
         i.getFlag(MODULE_ID, "partId") === part.id,
   )
   const currentActiveIndex =
      existingParents.length > 0
         ? existingParents[0].getFlag(MODULE_ID, "activeThresholdIndex")
         : -1

   const isFullHeal = part.hp.value === part.hp.max
   let shouldRemoveParent = false
   let shouldApplyNewParent = false

   if (activeIndex !== currentActiveIndex) {
      let currentHpValue = Infinity
      if (currentActiveIndex !== -1 && part.thresholds[currentActiveIndex]) {
         currentHpValue = part.thresholds[currentActiveIndex].hpValue
      }
      const newHpValue = activeThreshold ? activeThreshold.hpValue : Infinity
      const isGettingBetter = newHpValue > currentHpValue

      if (isGettingBetter) {
         if (part.removeEffectsOnFullHeal) {
            if (isFullHeal) {
               shouldRemoveParent = true
               if (activeThreshold) shouldApplyNewParent = true
            }
         } else {
            shouldRemoveParent = true
            if (activeThreshold) shouldApplyNewParent = true
         }
      } else {
         shouldRemoveParent = true
         if (activeThreshold) shouldApplyNewParent = true
      }
   }

   if (shouldRemoveParent && existingParents.length > 0) {
      await actor.deleteEmbeddedDocuments(
         "Item",
         existingParents.map((e) => e.id),
         { rntForceDelete: true },
      )
   }

   if (shouldApplyNewParent && activeThreshold) {
      const parentEffectData = createParentEffectData(part, activeThreshold)
      parentEffectData.flags[MODULE_ID].activeThresholdIndex = activeIndex
      await actor.createEmbeddedDocuments("Item", [parentEffectData])

      if (activeThreshold.damages && activeThreshold.damages.length > 0) {
         const DamageRoll =
            window.DamageRoll ||
            CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ||
            window.Roll
         const tokenDoc = actor.token ?? actor.getActiveTokens()[0]?.document
         const targetData = tokenDoc
            ? { actor: actor.uuid, token: tokenDoc.uuid }
            : null

         for (const d of activeThreshold.damages) {
            if (!d.diceNum && d.diceNum !== 0) continue
            let formula = d.diceStep
               ? `${d.diceNum}d${d.diceStep}`
               : `${d.diceNum}`
            const tags = []

            if (d.dmgType === "bleed") {
               tags.push("persistent", "bleed")
            } else if (d.dmgCategory === "persistent") {
               tags.push("persistent", d.dmgType)
            } else if (d.dmgCategory) {
               tags.push(d.dmgCategory, d.dmgType)
            } else {
               tags.push(d.dmgType)
            }

            formula += `[${tags.join(",")}]`
            const roll = new DamageRoll(formula)
            await roll.evaluate()
            roll.toMessage({
               speaker: ChatMessage.getSpeaker({ actor, token: tokenDoc }),
               flavor: `<strong>${part.name}</strong> ${game.i18n.localize(`${MODULE_ID}.thresholdBreached`)}`,
               flags: {
                  pf2e: {
                     target: targetData,
                     context: { type: "damage-roll", target: targetData },
                  },
               },
            })
         }
      }

      if (activeThreshold.macros && activeThreshold.macros.length > 0) {
         for (const mac of activeThreshold.macros) {
            if (!mac.uuid || mac.invalid) continue
            const macroObj = await fromUuid(mac.uuid)
            if (macroObj && macroObj.documentName === "Macro") {
               macroObj.execute({ actor, part, threshold: activeThreshold })
            }
         }
      }
   }

   await actor.setFlag(MODULE_ID, "parts", parts)
}
