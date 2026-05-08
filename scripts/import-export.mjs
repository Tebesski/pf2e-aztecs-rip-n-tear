import { MODULE_ID } from "./constants.mjs"

const FORMAT_VERSION = 1

export function safeFilename(base, ext = "json") {
   const cleaned =
      String(base || "untitled")
         .trim()
         .replace(/[^a-z0-9_\-]+/gi, "_")
         .replace(/^_+|_+$/g, "")
         .slice(0, 60) || "untitled"
   return `${cleaned}.${ext}`
}

function cleanPart(p) {
   const out = foundry.utils.deepClone(p)
   out.id = foundry.utils.randomID()
   delete out.dependentParts
   out.linkedItems = []
   out.linkedEntries = []
   out.linkedSpells = []
   if (out.hp && typeof out.hp === "object") {
      out.hp.value = out.hp.max
   }
   if (Array.isArray(out.thresholds)) {
      out.thresholds = out.thresholds.map((t) => {
         const tt = foundry.utils.deepClone(t)
         delete tt.linkedPartsData
         return tt
      })
   }
   return out
}

function cleanReaction(r) {
   const out = foundry.utils.deepClone(r)
   out.id = foundry.utils.randomID()
   return out
}

function cleanDeathReaction(d) {
   const out = foundry.utils.deepClone(d)
   if (out.id !== undefined) out.id = foundry.utils.randomID()
   return out
}

export function buildElementExport(kind, data) {
   const cleaner =
      kind === "part"
         ? cleanPart
         : kind === "reaction"
           ? cleanReaction
           : cleanDeathReaction
   return {
      module: MODULE_ID,
      format: FORMAT_VERSION,
      kind,
      data: cleaner(data),
   }
}

export function buildTemplateExport(template) {
   return {
      module: MODULE_ID,
      format: FORMAT_VERSION,
      kind: "template",
      data: foundry.utils.deepClone(template),
   }
}

export function downloadJson(payload, filename) {
   const json = JSON.stringify(payload, null, 2)
   if (typeof saveDataToFile === "function") {
      saveDataToFile(json, "application/json", filename)
   } else {
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
   }
}

export function pickJsonFile() {
   return new Promise((resolve) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "application/json,.json"
      input.style.display = "none"
      document.body.appendChild(input)
      let resolved = false
      const cleanup = () => {
         if (input.parentNode) input.parentNode.removeChild(input)
      }
      input.addEventListener("change", () => {
         const file = input.files?.[0]
         if (!file) {
            resolved = true
            cleanup()
            resolve(null)
            return
         }
         const reader = new FileReader()
         reader.onload = () => {
            cleanup()
            try {
               resolve(JSON.parse(reader.result))
            } catch (err) {
               ui.notifications.error(
                  game.i18n.localize(`${MODULE_ID}.importErrorBadJson`),
               )
               resolve(null)
            }
         }
         reader.onerror = () => {
            cleanup()
            ui.notifications.error(
               game.i18n.localize(`${MODULE_ID}.importErrorReadFail`),
            )
            resolve(null)
         }
         reader.readAsText(file)
      })
      const onFocus = () => {
         setTimeout(() => {
            if (!resolved && !input.files?.length) {
               cleanup()
               resolve(null)
            }
            window.removeEventListener("focus", onFocus)
         }, 200)
      }
      window.addEventListener("focus", onFocus, { once: true })
      input.click()
   })
}

export function validateEnvelope(envelope, expectedKinds) {
   if (!envelope || typeof envelope !== "object") {
      ui.notifications.warn(
         game.i18n.localize(`${MODULE_ID}.importErrorBadJson`),
      )
      return null
   }
   if (envelope.module !== MODULE_ID) {
      ui.notifications.warn(
         game.i18n.localize(`${MODULE_ID}.importErrorWrongModule`),
      )
      return null
   }
   if (Array.isArray(expectedKinds) && !expectedKinds.includes(envelope.kind)) {
      ui.notifications.warn(
         game.i18n.format(`${MODULE_ID}.importErrorWrongKind`, {
            expected: expectedKinds.join(" / "),
            got: envelope.kind || "?",
         }),
      )
      return null
   }
   if (!envelope.data) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.importErrorEmpty`))
      return null
   }
   return envelope
}

export function regenerateTemplateIds(template) {
   const out = foundry.utils.deepClone(template)
   out.id = foundry.utils.randomID()
   if (Array.isArray(out.parts)) out.parts = out.parts.map(cleanPart)
   if (Array.isArray(out.reactions))
      out.reactions = out.reactions.map(cleanReaction)
   if (out.deathReaction)
      out.deathReaction = cleanDeathReaction(out.deathReaction)
   return out
}
