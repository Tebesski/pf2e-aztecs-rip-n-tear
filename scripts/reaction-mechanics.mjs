import { MODULE_ID } from "./constants.mjs"
import { playSfx } from "./sfx.mjs"
import { getActorHpValue, withRntDialogTheme } from "./actor-support.mjs"
import { extractDamageDataFromMessage } from "./reaction/damage-data.mjs"
import { collectTargets } from "./reaction/targets.mjs"
import { executeTrigger } from "./reaction/trigger-executor.mjs"
import {
   renderDialogMessage,
   renderReactionRequirements,
} from "./dialogs/content.mjs"
import { emText, strongText } from "./html-format.mjs"

export { createReactionChatCard } from "./reaction/chat-card.mjs"

export function registerReactionHooks() {
   document.addEventListener(
      "click",
      (event) => {
         const button = event.target.closest(
            "button[data-action='applyDamage'], button[data-action='target-applyDamage'], button[data-action='applyHealing'], button[data-action='target-applyHealing']",
         )

         if (button) {
            const messageElement = button.closest(".chat-message")
            if (messageElement) {
               const messageId = messageElement.dataset.messageId
               const message = game.messages.get(messageId)

               if (message) {
                  const data = extractDamageDataFromMessage(message)

                  window.RNT_PENDING_DAMAGE_SOURCE = {
                     timestamp: Date.now(),
                     damageTypes: data.damageTypes,
                     rollOptions: data.rollOptions,
                  }
               }
            }
         }
      },
      { capture: true },
   )

   Hooks.on("preUpdateActor", (actor, updates, options, userId) => {
      if (userId !== game.user.id) return
      const newHp = foundry.utils.getProperty(
         updates,
         "system.attributes.hp.value",
      )
      const currentHp = getActorHpValue(actor)
      if (newHp !== undefined && newHp < currentHp) {
         options.rntDamageTaken = currentHp - newHp
      }
      if (
         newHp !== undefined &&
         newHp <= 0 &&
         currentHp > 0
      ) {
         options.rntDeathTriggered = true
      }
   })

   Hooks.on("updateActor", async (actor, updates, options, userId) => {
      if (userId !== game.user.id) return

      if (options.rntDamageTaken) {
         const damageTaken =
            options.rntOriginalPartDamage || options.rntDamageTaken
         const damageSource = options.rntDamageSource || "creature"
         const partId = options.rntPartId || null

         const takenDamageTypes = new Set()
         const takenRollOptions = new Set()
         const actorToken = actor.token ?? actor.getActiveTokens()[0]?.document
         let isAdjacent = false

         const pending = window.RNT_PENDING_DAMAGE_SOURCE
         if (pending && Date.now() - pending.timestamp < 300000) {
            for (const t of pending.damageTypes) takenDamageTypes.add(t)
            for (const o of pending.rollOptions) takenRollOptions.add(o)
            window.RNT_PENDING_DAMAGE_SOURCE = null
         } else {
            const messages = Array.from(game.messages.contents).reverse()
            const recentDamageMsg = messages.find((m) => {
               const isDamage = m.flags?.pf2e?.context?.type === "damage-roll"
               const tToken =
                  m.flags?.pf2e?.context?.target?.token ||
                  m.flags?.pf2e?.target?.token
               const matches =
                  tToken === actorToken?.uuid || tToken === actorToken?.id
               return isDamage && matches && Date.now() - m.timestamp < 300000
            })

            if (recentDamageMsg) {
               const data = extractDamageDataFromMessage(recentDamageMsg)
               for (const t of data.damageTypes) takenDamageTypes.add(t)
               for (const o of data.rollOptions) takenRollOptions.add(o)

               let attackerToken = null
               const speakerTokenId = recentDamageMsg.speaker?.token
               if (speakerTokenId && canvas?.scene) {
                  attackerToken = canvas.scene.tokens.get(speakerTokenId)
               }
               if (
                  !attackerToken &&
                  recentDamageMsg.speaker?.actor &&
                  canvas?.scene
               ) {
                  attackerToken = canvas.scene.tokens.find(
                     (t) => t.actor?.id === recentDamageMsg.speaker.actor,
                  )
               }

               if (attackerToken && actorToken) {
                  const sourceToken =
                     attackerToken.object ||
                     canvas.tokens?.get(attackerToken.id)
                  const targetToken =
                     actorToken.object || canvas.tokens?.get(actorToken.id)
                  if (sourceToken && targetToken) {
                     let dist
                     if (typeof sourceToken.distanceTo === "function") {
                        dist = sourceToken.distanceTo(targetToken)
                     } else {
                        const dx = targetToken.x - sourceToken.x
                        const dy = targetToken.y - sourceToken.y
                        dist =
                           (Math.sqrt(dx * dx + dy * dy) /
                              canvas.dimensions.size) *
                           canvas.dimensions.distance
                     }
                     isAdjacent = dist <= 5
                  }
               }
            }
         }

         if (options.rntDmgType) takenDamageTypes.add(options.rntDmgType)

         evaluateReactions(
            actor,
            damageTaken,
            takenDamageTypes,
            takenRollOptions,
            damageSource,
            partId,
            isAdjacent,
         )
      }

      if (options.rntDeathTriggered) {
         evaluateDeathReaction(actor)
      }
   })

   Hooks.on("deleteItem", (item, options, userId) => {
      if (userId !== game.user.id) return
      if (item.getFlag(MODULE_ID, "isDelayedDeath") && item.parent) {
         const dr = item.getFlag(MODULE_ID, "deathReactionData")
         if (dr) triggerReaction(item.parent, dr, null, { isDeath: true })
      }
   })
}

export async function evaluateReactions(
   actor,
   damageTaken,
   takenDamageTypes,
   takenRollOptions,
   damageSource = "creature",
   damagedPartId = null,
) {
   if (!damageTaken) return
   const reactions = actor.getFlag(MODULE_ID, "reactions") || []
   if (reactions.length === 0) return

   for (const rx of reactions) {
      if (rx.disabled) continue

      const reactTo = rx.reactTo || "both"
      if (damageSource === "creature" && reactTo === "part") continue
      if (damageSource === "part" && reactTo === "creature") continue

      if (damageSource === "part" && rx.allParts === false) {
         if (!rx.specificParts || !rx.specificParts.includes(damagedPartId))
            continue
      }

      if (rx.minDamage && damageTaken < rx.minDamage) continue

      if (rx.damageTypes && rx.damageTypes.length > 0) {
         if (!takenDamageTypes || takenDamageTypes.size === 0) continue
         const hasMatchingType = rx.damageTypes.some((dt) =>
            takenDamageTypes.has(dt),
         )
         if (!hasMatchingType) continue
      }

      if (rx.conditionals) {
         const opts = takenRollOptions || new Set()
         const {
            onlyMelee,
            onlyUnarmed,
            onlyMagical,
            onlyPhysical,
            requiredRollOptions,
         } = rx.conditionals

         if (onlyMelee) {
            const hasMelee =
               opts.has("melee") ||
               opts.has("item:trait:melee") ||
               opts.has("trait:melee")
            if (!hasMelee) continue
         }

         if (onlyUnarmed) {
            const hasUnarmed =
               opts.has("unarmed") ||
               opts.has("item:trait:unarmed") ||
               opts.has("trait:unarmed")
            if (!hasUnarmed) continue
         }

         if (onlyMagical) {
            const hasMagical =
               opts.has("magical") ||
               opts.has("item:trait:magical") ||
               opts.has("trait:magical")
            if (!hasMagical) continue
         }

         if (onlyPhysical) {
            const hasMagical =
               opts.has("magical") ||
               opts.has("item:trait:magical") ||
               opts.has("trait:magical")
            if (hasMagical) continue
         }

         if (requiredRollOptions) {
            const reqs = requiredRollOptions
               .split(",")
               .map((s) => s.trim().toLowerCase())
               .filter((s) => s)
            const hasAll = reqs.every(
               (r) =>
                  opts.has(r) ||
                  opts.has(`item:trait:${r}`) ||
                  opts.has(`trait:${r}`),
            )
            if (!hasAll) continue
         }
      }

      const effectName = game.i18n.format(
         `${MODULE_ID}.reactionUsedEffectName`,
         { name: rx.name },
      )

      const reqTypes =
         rx.damageTypes && rx.damageTypes.length > 0
            ? await renderReactionRequirements(rx.damageTypes.join(", "))
            : ""
      const sourceText =
         damageSource === "part"
            ? game.i18n.localize(`${MODULE_ID}.damageSourceBodyPart`)
            : game.i18n.localize(`${MODULE_ID}.damageSourceCreature`)

      if (rx.actionType === "free") {
         const promptFree = game.settings.get(MODULE_ID, "promptFreeActions")
         if (promptFree) {
            foundry.applications.api.DialogV2.confirm(
               withRntDialogTheme(
                  {
                     window: {
                        title: game.i18n.format(
                           `${MODULE_ID}.triggerReactionTitle`,
                           { name: rx.name },
                        ),
                     },
                     content: await renderDialogMessage(
                        game.i18n.format(`${MODULE_ID}.promptTriggerFreeAction`, {
                           actorName: strongText(actor.name),
                           damageTaken,
                           sourceText,
                           reactionName: strongText(rx.name),
                           requirements: reqTypes,
                        }),
                     ),
                  },
                  actor,
               ),
            ).then((confirmed) => {
               if (confirmed) triggerReaction(actor, rx)
            })
         } else {
            triggerReaction(actor, rx)
         }
      } else {
         foundry.applications.api.DialogV2.confirm(
            withRntDialogTheme(
               {
                  window: {
                     title: game.i18n.format(
                        `${MODULE_ID}.triggerReactionTitle`,
                        { name: rx.name },
                     ),
                  },
                  content: await renderDialogMessage(
                     game.i18n.format(`${MODULE_ID}.promptTriggerReaction`, {
                        actorName: strongText(actor.name),
                        damageTaken,
                        sourceText,
                        reactionName: strongText(rx.name),
                        requirements: reqTypes,
                     }),
                  ),
               },
               actor,
            ),
         ).then((confirmed) => {
            if (confirmed) triggerReaction(actor, rx)
         })
      }
   }
}

export async function evaluateDeathReaction(actor) {
   const dr = actor.getFlag(MODULE_ID, "deathReaction")
   if (!dr || dr.disabled) return

   const effectName = game.i18n.format(
      `${MODULE_ID}.deathReactionUsedEffectName`,
      { name: dr.name },
   )
   if (actor.items.some((i) => i.name === effectName)) return

   foundry.applications.api.DialogV2.confirm(
      withRntDialogTheme(
         {
            window: {
               title: game.i18n.format(
                  `${MODULE_ID}.triggerDeathReactionTitle`,
                  { name: dr.name },
               ),
            },
            content: await renderDialogMessage(
               game.i18n.format(`${MODULE_ID}.promptTriggerDeathReaction`, {
                  actorName: strongText(actor.name),
                  reactionName: strongText(dr.name),
               }),
            ),
         },
         actor,
      ),
   ).then(async (confirmed) => {
      if (!confirmed) return
      const effectData = {
         name: effectName,
         type: "effect",
         img: "systems/pf2e/icons/actions/Passive.webp",
         system: {
            description: {
               value: game.i18n.localize(
                  `${MODULE_ID}.deathReactionUsedEffectDescription`,
               ),
            },
         },
         flags: { [MODULE_ID]: { isDeathReactionEffect: true } },
      }
      await actor.createEmbeddedDocuments("Item", [effectData])

      if (dr.useDelay) {
         const delayedData = {
            name: game.i18n.format(`${MODULE_ID}.delayedDeathEffectName`, {
               name: dr.name,
            }),
            type: "effect",
            img: "icons/svg/skull.svg",
            system: {
               duration: {
                  value: dr.delayRounds || 1,
                  unit: "rounds",
                  expiry: dr.expiry || "turn-end",
               },
               description: {
                  value: game.i18n.localize(
                     `${MODULE_ID}.delayedDeathEffectDescription`,
                  ),
               },
            },
            flags: {
               [MODULE_ID]: { isDelayedDeath: true, deathReactionData: dr },
            },
         }
         await actor.createEmbeddedDocuments("Item", [delayedData])
         ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: game.i18n.format(
               `${MODULE_ID}.delayedDeathReactionStarted`,
               {
                  actorName: strongText(actor.name),
                  reactionName: emText(dr.name),
               },
            ),
         })
      } else {
         triggerReaction(actor, dr, null, { isDeath: true })
      }
   })
}

export async function triggerReaction(
   actor,
   rx,
   manualTriggerer = null,
   options = {},
) {
   if (rx.actionType && rx.actionType !== "free") {
      const effectData = {
         name: game.i18n.format(`${MODULE_ID}.reactionUsedEffectName`, {
            name: rx.name,
         }),
         type: "effect",
         img: "systems/pf2e/icons/actions/Reaction.webp",
         system: {
            description: {
               value: game.i18n.localize(
                  `${MODULE_ID}.reactionUsedEffectDescription`,
               ),
            },
            duration: { value: 1, unit: "rounds", expiry: "turn-start" },
         },
         flags: { [MODULE_ID]: { isReactionEffect: true } },
      }
      await actor.createEmbeddedDocuments("Item", [effectData])
   }

   const actorToken = actor.token ?? actor.getActiveTokens()[0]?.document

   let resolvedTriggerer = manualTriggerer
   if (!resolvedTriggerer && !options.isManual) {
      const messages = Array.from(game.messages.contents).reverse()
      const recentDamageMsg = messages.find((m) => {
         const isDamage = m.flags?.pf2e?.context?.type === "damage-roll"
         const tToken =
            m.flags?.pf2e?.context?.target?.token ||
            m.flags?.pf2e?.target?.token
         const matches =
            tToken === actorToken?.uuid || tToken === actorToken?.id
         return isDamage && matches && Date.now() - m.timestamp < 60000
      })
      if (recentDamageMsg) {
         const speakerTokenId = recentDamageMsg.speaker?.token
         if (speakerTokenId && canvas.scene) {
            resolvedTriggerer = canvas.scene.tokens.get(speakerTokenId)
         }
         if (
            !resolvedTriggerer &&
            recentDamageMsg.speaker?.actor &&
            canvas.scene
         ) {
            resolvedTriggerer = canvas.scene.tokens.find(
               (t) => t.actor?.id === recentDamageMsg.speaker.actor,
            )
         }
      }
   }

   if (rx.sfxTrigger) {
      let hasAnyTargets = false
      for (const trigger of rx.triggers) {
         const targets = collectTargets(trigger, actorToken, resolvedTriggerer)
         if (trigger.target === "triggerer" && targets.length === 0) continue
         if (targets.length > 0) {
            hasAnyTargets = true
            break
         }
      }

      if (hasAnyTargets || rx.playSfxNoTarget) {
         const sfxType = options.isDeath ? "deathReaction" : "damageReaction"
         await playSfx(rx.sfxTrigger, sfxType)
      }
   }

   for (const trigger of rx.triggers) {
      const targets = collectTargets(trigger, actorToken, resolvedTriggerer)

      if (trigger.target === "triggerer" && targets.length === 0) continue

      if (targets.length === 0) {
         if (trigger.type !== "damage" && trigger.type !== "saving-throw") {
            if (options.isManual) {
               ui.notifications.warn(
                  game.i18n.format(`${MODULE_ID}.reactionRequiresTarget`, {
                     name: rx.name,
                  }),
               )
            }
            continue
         }
      }

      if (targets.length > 0) {
         Array.from(game.user.targets).forEach((t) =>
            t.setTarget(false, { releaseOthers: false }),
         )
         targets.forEach((tDoc) => {
            if (tDoc.object)
               tDoc.object.setTarget(true, { releaseOthers: false })
         })
      }

      await executeTrigger(
         trigger,
         rx,
         actor,
         actorToken,
         targets,
         resolvedTriggerer,
         options,
      )
   }
}
