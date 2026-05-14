import { MODULE_ID, SFX_KEYS } from "./constants.mjs"

export async function resolveSfxPath(path) {
   if (!path || typeof path !== "string") return null
   if (!path.includes("*")) return path

   let source = "data"
   let cleanPath = path

   const sourceMatch = cleanPath.match(/^\[([^\]]+)\]\s*(.*)/)
   if (sourceMatch) {
      source = sourceMatch[1]
      cleanPath = sourceMatch[2]
   }

   const segments = cleanPath.split("/")
   const pattern = segments.pop()
   const dir = segments.join("/") || ""

   try {
      const FPClass =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      const result = await FPClass.browse(source, dir)
      let regexStr = "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")
      regexStr += pattern.includes(".") ? "$" : "\\.[^.]+$"
      const regex = new RegExp(regexStr, "i")

      const matches = result.files.filter((f) =>
         regex.test(decodeURIComponent(f).split("/").pop()),
      )

      if (matches.length > 0) {
         return matches[Math.floor(Math.random() * matches.length)]
      }
   } catch (e) {
      console.error("Rip & Tear | SFX Wildcard error:", e)
   }
   return null
}

export function getSfxVolume(type) {
   const key = SFX_KEYS[type]
   if (!key) return 0.8
   const value = game.settings.get(MODULE_ID, key)
   return typeof value === "number" ? value : 0.8
}

export async function playSfx(path, type, broadcast = true) {
   if (!path) return
   const resolved = await resolveSfxPath(path)
   if (!resolved) return
   const volume = getSfxVolume(type)
   if (volume <= 0) return
   const AH = foundry.audio?.AudioHelper ?? AudioHelper
   AH.play({ src: resolved, volume }, broadcast)
}

const FIELD_TO_TYPE = {
   sfxDamage: "damage",
   sfxHeal: "heal",
   sfxDestroy: "destroy",
   sfxTrigger: "damageReaction",
}

export function sfxTypeForFieldName(name, fallback = "damage") {
   return FIELD_TO_TYPE[name] || fallback
}
