export function damageTags(damage) {
   const tags = []
   if (damage.dmgType === "bleed") {
      tags.push("persistent", "bleed")
   } else {
      if (damage.dmgCategory === "persistent") tags.push("persistent")
      else if (damage.dmgCategory) tags.push(damage.dmgCategory)
      if (damage.dmgType) tags.push(damage.dmgType)
   }
   return tags
}

export function damageFormulaParts(damages = []) {
   return damages.map((damage) => {
      const num = damage.diceNum || 0
      const formula = damage.diceStep ? `${num}d${damage.diceStep}` : `${num}`
      const tags = damageTags(damage)
      const tagStr = tags.length > 0 ? `[${tags.join(",")}]` : ""
      return `${formula}${tagStr}`
   })
}

function normalizeOptions(options) {
   if (options instanceof Set) return Array.from(options)
   if (Array.isArray(options)) return options
   if (options && typeof options === "object") return Object.values(options)
   return []
}

function collectOptionData(options, damageTypes, rollOptions) {
   for (const option of normalizeOptions(options)) {
      if (typeof option !== "string") continue
      rollOptions.add(option.toLowerCase())
      if (option.startsWith("item:damage:type:"))
         damageTypes.add(option.split("item:damage:type:")[1])
      if (option.startsWith("item:damage:category:"))
         damageTypes.add(option.split("item:damage:category:")[1])
      if (option.startsWith("damage:type:"))
         damageTypes.add(option.split("damage:type:")[1])
   }
}

export function extractDamageDataFromMessage(message) {
   const damageTypes = new Set()
   const rollOptions = new Set()

   collectOptionData(
      message.flags?.pf2e?.context?.options || [],
      damageTypes,
      rollOptions,
   )

   for (const roll of message.rolls || []) {
      collectOptionData(roll.options || [], damageTypes, rollOptions)
      const instances = roll.instances || [roll]
      for (const instance of instances) {
         if (instance.type) damageTypes.add(instance.type)
         if (instance.category) damageTypes.add(instance.category)
      }
   }

   return { damageTypes, rollOptions }
}
