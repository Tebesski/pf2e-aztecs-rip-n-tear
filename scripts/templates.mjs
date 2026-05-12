import { MODULE_ID } from "./constants.mjs"

const SETTING_KEY = "templates"

export function getAllTemplates() {
   const raw = game.settings.get(MODULE_ID, SETTING_KEY) || []
   return Array.isArray(raw) ? raw : []
}

export async function setAllTemplates(list) {
   const arr = Array.isArray(list) ? list : []
   await game.settings.set(MODULE_ID, SETTING_KEY, arr)
}

export async function saveTemplate(template) {
   const all = getAllTemplates()
   const idx = all.findIndex((t) => t.id === template.id)
   if (idx >= 0) all[idx] = template
   else all.push(template)
   await setAllTemplates(all)
}

export async function removeTemplateById(id) {
   const all = getAllTemplates().filter((t) => t.id !== id)
   await setAllTemplates(all)
}

export async function removeTemplatesByIds(ids) {
   const set = new Set(ids)
   const all = getAllTemplates().filter((t) => !set.has(t.id))
   await setAllTemplates(all)
}

export function getTemplateById(id) {
   return getAllTemplates().find((t) => t.id === id) || null
}

export async function applyTemplateToActor(actor, template, mode = "append") {
   if (!actor || !template) return

   const idMap = new Map()

   const newParts = (template.parts || []).map((p) => {
      const newId = foundry.utils.randomID()
      idMap.set(p.id, newId)
      return {
         ...foundry.utils.deepClone(p),
         id: newId,
      }
   })

   newParts.forEach((p) => {
      if (Array.isArray(p.thresholds)) {
         p.thresholds.forEach((t) => {
            if (Array.isArray(t.linkedParts)) {
               t.linkedParts = t.linkedParts.map(
                  (oldId) => idMap.get(oldId) || oldId,
               )
            }
         })
      }
   })

   const newReactions = (template.reactions || []).map((r) => {
      const clone = {
         ...foundry.utils.deepClone(r),
         id: foundry.utils.randomID(),
      }
      if (Array.isArray(clone.specificParts)) {
         clone.specificParts = clone.specificParts.map(
            (oldId) => idMap.get(oldId) || oldId,
         )
      }
      return clone
   })

   const newDeathReaction = template.deathReaction
      ? {
           ...foundry.utils.deepClone(template.deathReaction),
           id: foundry.utils.randomID(),
        }
      : null

   if (mode === "replace") {
      await actor.setFlag(MODULE_ID, "parts", newParts)
      await actor.setFlag(MODULE_ID, "reactions", newReactions)
      if (newDeathReaction)
         await actor.setFlag(MODULE_ID, "deathReaction", newDeathReaction)
      else await actor.unsetFlag(MODULE_ID, "deathReaction")
      return
   }

   const existingParts = actor.getFlag(MODULE_ID, "parts") || []
   const existingReactions = actor.getFlag(MODULE_ID, "reactions") || []
   const existingDeath = actor.getFlag(MODULE_ID, "deathReaction") || null

   await actor.setFlag(MODULE_ID, "parts", [...existingParts, ...newParts])
   await actor.setFlag(MODULE_ID, "reactions", [
      ...existingReactions,
      ...newReactions,
   ])
   if (!existingDeath && newDeathReaction)
      await actor.setFlag(MODULE_ID, "deathReaction", newDeathReaction)
}

export function snapshotFromActor(actor) {
   return {
      parts: foundry.utils.deepClone(actor.getFlag(MODULE_ID, "parts") || []),
      reactions: foundry.utils.deepClone(
         actor.getFlag(MODULE_ID, "reactions") || [],
      ),
      deathReaction: foundry.utils.deepClone(
         actor.getFlag(MODULE_ID, "deathReaction") || null,
      ),
   }
}

export function findAutoApplyTemplatesForActor(actor) {
   if (!actor || actor.type !== "npc") return []
   const traits = new Set(
      (actor.system?.traits?.value || []).map((t) => String(t).toLowerCase()),
   )
   if (!traits.size) return []
   return getAllTemplates().filter((t) => {
      if (!t.autoApply || !Array.isArray(t.traits) || !t.traits.length)
         return false
      return t.traits.every((tr) => traits.has(String(tr).toLowerCase()))
   })
}

export function hasAutoApplyRun(actor) {
   return !!actor.getFlag(MODULE_ID, "autoApplyDone")
}

export async function markAutoApplyRun(actor) {
   await actor.setFlag(MODULE_ID, "autoApplyDone", true)
}
