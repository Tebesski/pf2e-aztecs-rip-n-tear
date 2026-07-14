import { MODULE_ID } from "../constants.mjs"

export async function createReactionChatCard(
   actor,
   reaction,
   trigger,
   targets,
   options = {},
) {
   const saveType = trigger.saveType || "reflex"
   const saveDc = parseInt(trigger.dc) || 15
   const dmgList = trigger.isBasicSave ? trigger.basicDamages : trigger.damages
   const hasDamage = dmgList && dmgList.length > 0

   let damageFormula = ""
   let damageTotal = 0
   let evaluatedDamages = []

   if (hasDamage && dmgList && dmgList.length > 0) {
      const PF2eDamageRoll =
         window.DamageRoll ||
         game.pf2e?.DamageRoll ||
         CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ||
         window.Roll
      if (PF2eDamageRoll) {
         const parts = dmgList.map((d) => {
            const num = d.diceNum || 0
            const formula = d.diceStep ? `${num}d${d.diceStep}` : `${num}`
            const tags = []
            if (d.dmgType === "bleed") tags.push("persistent", "bleed")
            else {
               if (d.dmgCategory === "persistent") tags.push("persistent")
               else if (d.dmgCategory) tags.push(d.dmgCategory)
               if (d.dmgType) tags.push(d.dmgType)
            }
            const tagStr = tags.length > 0 ? `[${tags.join(",")}]` : ""
            return `${formula}${tagStr}`
         })

         if (parts.length > 0) {
            const roll = new PF2eDamageRoll(parts.join(","))
            await roll.evaluate()
            damageFormula = roll.formula
            damageTotal = roll.total

            const iconMap = {
               acid: "fa-flask",
               bleed: "fa-droplet",
               bludgeoning: "fa-hammer",
               cold: "fa-snowflake",
               electricity: "fa-bolt",
               fire: "fa-fire",
               force: "fa-sparkles",
               mental: "fa-brain",
               piercing: "fa-bow-arrow",
               poison: "fa-vial",
               slashing: "fa-axe",
               sonic: "fa-wave-square",
               vitality: "fa-sun",
               void: "fa-skull",
               spirit: "fa-ghost",
               holy: "fa-cross",
               unholy: "fa-pentagram",
               untyped: "fa-burst",
            }

            const instances = roll.instances || [roll]
            for (const inst of instances) {
               const dType = inst.type || "untyped"
               const cat = inst.category || ""
               evaluatedDamages.push({
                  amount: inst.total,
                  dmgType: dType,
                  icon: iconMap[dType] || "fa-burst",
                  isPersistent: cat === "persistent",
                  isPrecision: cat === "precision",
                  isSplash: cat === "splash",
               })
            }
         }
      }
   }

   const targetData = (targets || []).map((t) => ({
      uuid: t.document ? t.document.uuid : t.uuid,
      name: t.name,
   }))

   const templateData = {
      actor: { id: actor.id, name: actor.name },
      reaction: {
         id: reaction.id,
         name: reaction.name,
         img: reaction.img || "icons/svg/explosion.svg",
      },
      hasSave: true,
      saveType,
      saveDc,
      hasDamage,
      evaluatedDamages,
      damageTotal,
      targets: targetData,
   }

   const renderTpl =
      foundry.applications?.handlebars?.renderTemplate ?? renderTemplate
   const content = await renderTpl(
      `modules/${MODULE_ID}/templates/reaction-chat-card.hbs`,
      templateData,
   )

   await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: content,
      flags: {
         [MODULE_ID]: {
            isReactionCard: true,
            reactionData: reaction,
            triggerData: trigger,
            damages: evaluatedDamages,
            totalDamage: damageTotal,
            isDeathReaction: options.isDeath || false,
         },
      },
   })
}
