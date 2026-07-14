import { ENERGY_TYPES, PHYSICAL_TYPES } from "../constants.mjs"

export function parseIWRString(str) {
   if (!str || typeof str !== "string") return []
   return str
      .split(",")
      .map((s) => {
         let exceptions = []
         let mainPart = s
         if (s.includes(" except ")) {
            const splitExc = s.split(" except ")
            mainPart = splitExc[0]
            exceptions = splitExc[1].trim().split(" ")
         }
         const parts = mainPart.trim().toLowerCase().split(" ")
         return { type: parts[0], value: parseInt(parts[1]) || 0, exceptions }
      })
      .filter((x) => x.type)
}

export function checkIWRMatch(
   iwrType,
   dmgType,
   rollOptions = new Set(),
   exceptions = [],
   globalExceptions = [],
) {
   if (!iwrType || !dmgType) return false

   const allExceptions = [...exceptions, ...globalExceptions]
   for (const exc of allExceptions) {
      const e = exc.toLowerCase()
      if (dmgType.toLowerCase() === e) return false
      if (rollOptions.has(e)) return false
      if (rollOptions.has(`item:material:${e}`)) return false
      if (rollOptions.has(`item:trait:${e}`)) return false
      if (rollOptions.has(`trait:${e}`)) return false
   }

   const iwr = iwrType.toLowerCase()
   const dmg = dmgType.toLowerCase()
   if (iwr === dmg) return true
   if (iwr === "all-damage" || iwr === "all") return true
   if (iwr === "physical" && PHYSICAL_TYPES.includes(dmg)) return true
   if (iwr === "energy" && ENERGY_TYPES.includes(dmg)) return true
   return false
}
