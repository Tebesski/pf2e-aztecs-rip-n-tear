import { prepareBodyPartDisplay } from "../utils.mjs"
import { MODULE_ID } from "../constants.mjs"

export function formatHpState(part) {
   const displayData = prepareBodyPartDisplay(part, null)
   let display = displayData.hpDisplay || ""
   const prefixes = [
      "HP: ",
      game.i18n.localize(`${MODULE_ID}.hpPercentagePrefix`),
   ].filter(Boolean)
   for (const prefix of prefixes) {
      if (display.startsWith(prefix)) {
         display = display.slice(prefix.length).trim()
         break
      }
   }
   return display
}
