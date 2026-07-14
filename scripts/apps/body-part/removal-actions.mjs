import { MODULE_ID } from "../../constants.mjs"

export async function removeIwrValue(app, itemNameKey, iwrKey, raw) {
   if (!(await app._confirmRemoval(itemNameKey))) return false
   await app._saveCurrentState()
   const parts = app._getParts()
   const part = parts.find((p) => p.id === app.partId)
   if (!part) return false

   const values = part.iwr?.[iwrKey]
      ? part.iwr[iwrKey]
           .split(",")
           .map((value) => value.trim())
           .filter(Boolean)
      : []
   part.iwr[iwrKey] = values.filter((value) => value !== raw).join(", ")
   await app.actor.setFlag(MODULE_ID, "parts", parts)
   app._saveViewState()
   app.render()
   return true
}
