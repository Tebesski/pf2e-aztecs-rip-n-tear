import { MODULE_ID } from "../constants.mjs"
import {
   extractDamageFromMessage,
   getTargetDoc,
   targetRefsMatch,
} from "./damage-message.mjs"
import { renderCalledShotFlavor } from "./chat-flavor.mjs"

export function setupPreCreateChatMessageHook() {
   Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
      if (userId !== game.user.id) return

      const context = message.flags?.pf2e?.context

      if (context?.type === "attack-roll") {
         const optionsArray =
            context.options instanceof Set
               ? Array.from(context.options)
               : context.options || []
         const calledShotOption = optionsArray.find((o) =>
            o.startsWith("called-shot:"),
         )

         if (calledShotOption) {
            const partId = calledShotOption.split(":")[1]
            const targetTokenDoc = getTargetDoc(context.target?.token)
            const parts =
               targetTokenDoc?.actor?.getFlag(MODULE_ID, "parts") || []
            const part = parts.find((p) => p.id === partId)

            if (part) {
               message.updateSource({
                  [`flags.${MODULE_ID}.calledShotPartId`]: part.id,
                  [`flags.${MODULE_ID}.calledShotPartName`]: part.name,
               })

               let flavor = message.flavor || ""
               const ac = context.dc?.value

               flavor = flavor.replace(
                  /(<span[^>]*data-whose="opposer"[^>]*>Target:\s*[^<]+)(<\/span>)/i,
                  `$1 [${part.name}]$2`,
               )

               if (ac !== undefined) {
                  flavor = flavor.replace(
                     /(<span[^>]*data-visibility="gm"[^>]*data-whose="opposer"[^>]*>\((?:DC|AC)\s*)\d+(\)<\/span>)/i,
                     `$1${ac}$2`,
                  )
               }

               message.updateSource({ flavor })
            }
         }
      }

      const isMerged = message.flags?.["pf2e-toolbelt"]?.mergeDamage?.merged
      const isDamage =
         message.isDamageRoll || context?.type === "damage-roll" || isMerged

      if (isDamage) {
         const pending =
            window.rntPendingCalledShot ||
            game.user.getFlag(MODULE_ID, "pendingDamageCalledShot")

         const optionsArray =
            context?.options instanceof Set
               ? Array.from(context.options)
               : context?.options || []
         const calledShotOption = optionsArray.find((o) =>
            o.startsWith("called-shot:"),
         )

         let partId =
            message.flags?.[MODULE_ID]?.calledShotPartId || pending?.partId
         let partName =
            message.flags?.[MODULE_ID]?.calledShotPartName || pending?.partName

         let targetTokenUuid =
            message.flags?.[MODULE_ID]?.targetUuid ||
            pending?.targetToken ||
            context?.target?.token ||
            message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets?.[0]

         if (!partId && calledShotOption) {
            partId = calledShotOption.split(":")[1]
         }

         const targetDoc = getTargetDoc(targetTokenUuid)
         if (targetDoc && partId && !partName) {
            const parts = targetDoc.actor?.getFlag(MODULE_ID, "parts") || []
            const part = parts.find((p) => p.id === partId)
            if (part) partName = part.name
         }

         const { damages, totalDamage, rollOptions } =
            extractDamageFromMessage(message)

         const updateData = {
            [`flags.${MODULE_ID}.damages`]: damages,
            [`flags.${MODULE_ID}.totalDamage`]: totalDamage,
            [`flags.${MODULE_ID}.rollOptions`]: rollOptions,
         }

         if (targetDoc) {
            updateData[`flags.${MODULE_ID}.targetUuid`] = targetDoc.uuid
         }

         const targetMatches =
            !targetTokenUuid ||
            !context?.target?.token ||
            targetTokenUuid === context.target.token ||
            targetTokenUuid === context.target.token?.uuid ||
            targetRefsMatch(targetTokenUuid, context.target.token)


         if (partId && targetMatches) {
            window.rntPendingCalledShot = null
            game.user.unsetFlag(MODULE_ID, "pendingDamageCalledShot")

            const updatedOptions = new Set(optionsArray)
            updatedOptions.add(`called-shot:${partId}`)

            updateData["flags.pf2e.context.options"] =
               Array.from(updatedOptions)
            updateData[`flags.${MODULE_ID}.isCalledShotDamage`] = true
            updateData[`flags.${MODULE_ID}.calledShotPartId`] = partId
            updateData[`flags.${MODULE_ID}.calledShotPartName`] = partName

            let flavor = message.flavor || ""
            if (!flavor.includes(`[${partName}]`)) {
               flavor += renderCalledShotFlavor(partName)
               updateData.flavor = flavor
            }
         } else if (partId && !targetMatches) {
         }

         message.updateSource(updateData)
      }
   })
}
