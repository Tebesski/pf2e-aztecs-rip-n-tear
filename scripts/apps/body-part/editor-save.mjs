import {
   getDefaultBodyPartIcon,
   isSiegeVehicleActor,
   normalizeRntThresholdTargets,
} from "../../actor-support.mjs"

export async function saveBodyPartEditorState() {
   const form = this.element.querySelector("form")
   if (!form) return
   const FDClass =
      foundry.applications?.ux?.FormDataExtended ?? FormDataExtended
   const formData = new FDClass(form)
   const updatedPart = foundry.utils.expandObject(formData.object)

   const index = this.workingParts.findIndex((p) => p.id === this.partId)
   if (index === -1) return
   const currentPart = this.workingParts[index] || {}

   const asString = (v) =>
      Array.isArray(v)
         ? String(v[v.length - 1] ?? "")
         : v == null
           ? ""
           : String(v)

   updatedPart.id = this.partId
   updatedPart.useRupture = !!updatedPart.useRupture
   updatedPart.dealsDamage = !!updatedPart.dealsDamage
   updatedPart.persistentDealsDamage = !!updatedPart.persistentDealsDamage
   updatedPart.failedRuptureDealsDamage = !!updatedPart.failedRuptureDealsDamage
   updatedPart.removeEffectsOnFullHeal = !!updatedPart.removeEffectsOnFullHeal
   updatedPart.customIWR = !!updatedPart.customIWR

   if (updatedPart.regrowth) {
      updatedPart.regrowth.enabled = !!updatedPart.regrowth.enabled
      updatedPart.regrowth.full = !!updatedPart.regrowth.full
      updatedPart.regrowth.anyTurn = !!updatedPart.regrowth.anyTurn
   } else {
      updatedPart.regrowth = {
         enabled: false,
         full: false,
         anyTurn: false,
         amount: 0,
      }
   }
   updatedPart.linkedItems = currentPart.linkedItems || []
   updatedPart.linkedEntries = currentPart.linkedEntries || []
   updatedPart.linkedSpells = currentPart.linkedSpells || []
   updatedPart.linkedModules = currentPart.linkedModules || []
   updatedPart.isHidden = currentPart.isHidden ?? false
   updatedPart.img = asString(updatedPart.img) || getDefaultBodyPartIcon(this.actor)

   if (updatedPart.saves) {
      for (const k of ["fortitude", "reflex", "will"]) {
         updatedPart.saves[k] = updatedPart.saves[k] || {}
         updatedPart.saves[k].enabled = !!updatedPart.saves[k].enabled
         const num = parseInt(updatedPart.saves[k].adjustment)
         updatedPart.saves[k].adjustment = isNaN(num) ? 0 : num
         delete updatedPart.saves[k].value
      }
   } else {
      updatedPart.saves = currentPart.saves || {
         fortitude: { enabled: false, adjustment: 0 },
         reflex: { enabled: false, adjustment: 0 },
         will: { enabled: false, adjustment: 0 },
      }
   }

   delete updatedPart.acceptedDmgTypesSelect
   if (!updatedPart.acceptedDmgTypes) updatedPart.acceptedDmgTypes = []
   else if (!Array.isArray(updatedPart.acceptedDmgTypes))
      updatedPart.acceptedDmgTypes = [updatedPart.acceptedDmgTypes]
   updatedPart.acceptedDmgTypes = updatedPart.acceptedDmgTypes
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim())
      .filter((t) => t)

   delete updatedPart.disableRegenDmgTypesSelect
   if (!updatedPart.disableRegenDmgTypes) updatedPart.disableRegenDmgTypes = []
   else if (!Array.isArray(updatedPart.disableRegenDmgTypes))
      updatedPart.disableRegenDmgTypes = [updatedPart.disableRegenDmgTypes]
   updatedPart.disableRegenDmgTypes = updatedPart.disableRegenDmgTypes
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim())
      .filter((t) => t)

   updatedPart.disableRegenDurationValue =
      parseInt(updatedPart.disableRegenDurationValue) || 1
   updatedPart.disableRegenDurationUnit =
      asString(updatedPart.disableRegenDurationUnit) || "rounds"

   if (updatedPart.iwr) {
      updatedPart.iwr.immune = asString(updatedPart.iwr.immune)
      updatedPart.iwr.weak = asString(updatedPart.iwr.weak)
      updatedPart.iwr.resist = asString(updatedPart.iwr.resist)
      updatedPart.iwr.immuneExc = asString(updatedPart.iwr.immuneExc)
      updatedPart.iwr.weakExc = asString(updatedPart.iwr.weakExc)
      updatedPart.iwr.resistExc = asString(updatedPart.iwr.resistExc)
   } else {
      updatedPart.iwr = currentPart.iwr || {
         immune: "",
         weak: "",
         resist: "",
         immuneExc: "",
         weakExc: "",
         resistExc: "",
      }
   }

   const cleanSlug = (v) => {
      const s = asString(v)
      if (s.includes(",")) return s.split(",")[0].trim()
      return s.trim()
   }

   const cleanPath = (v) => {
      const s = asString(v)
      if (s.includes(",")) return s.split(",")[0].trim()
      return s
   }

   const cleanNumber = (v) => {
      const num = Number(v)
      return Number.isFinite(num) ? num : 0
   }

   if (updatedPart.thresholds) {
      const showLinkedModules = isSiegeVehicleActor(this.actor)
      updatedPart.thresholds = Object.values(updatedPart.thresholds).map(
         (t, thresholdIndex) => {
            const currentThreshold = currentPart.thresholds?.[thresholdIndex] || {}
            const cleanTargets = (entry, currentEntry = {}) =>
               showLinkedModules
                  ? normalizeRntThresholdTargets(
                       entry?.targets ?? currentEntry.targets,
                    )
                  : normalizeRntThresholdTargets(currentEntry.targets)
            t.linkedParts = t.linkedParts
               ? Array.isArray(t.linkedParts)
                  ? t.linkedParts
                       .flatMap((v) => String(v).split(","))
                       .map((v) => v.trim())
                       .filter((v) => v)
                  : String(t.linkedParts)
                       .split(",")
                       .map((v) => v.trim())
                       .filter((v) => v)
               : []
            t.disableAbilities = !!t.disableAbilities
            t.disableModules = showLinkedModules
               ? !!t.disableModules
               : !!currentThreshold.disableModules
            t.modifyVehicleLoadCapacity = showLinkedModules
               ? !!t.modifyVehicleLoadCapacity
               : false
            t.vehicleLoadCapacityModifier = showLinkedModules
               ? cleanNumber(t.vehicleLoadCapacityModifier)
               : 0
            t.modifyVehicleSpeed = showLinkedModules
               ? !!t.modifyVehicleSpeed
               : false
            t.vehicleSpeedModifier = showLinkedModules
               ? cleanNumber(t.vehicleSpeedModifier)
               : 0
            t.hpValue = parseInt(t.hpValue) || 0
            t.conditions = t.conditions
               ? Object.values(t.conditions).map((c, conditionIndex) => ({
                    slug: cleanSlug(c.slug),
                    value: parseInt(c.value) || 1,
                    durationValue: parseInt(c.durationValue) || null,
                    durationUnit: asString(c.durationUnit) || "",
                    targets: cleanTargets(
                       c,
                       currentThreshold.conditions?.[conditionIndex],
                    ),
                 }))
               : []
            t.effects = t.effects
               ? Object.values(t.effects).map((e, effectIndex) => ({
                    uuid: asString(e.uuid),
                    name: asString(e.name),
                    img: cleanPath(e.img),
                    invalid: String(e.invalid) === "true",
                    durationValue: parseInt(e.durationValue) || null,
                    durationUnit: asString(e.durationUnit) || "",
                    targets: cleanTargets(
                       e,
                       currentThreshold.effects?.[effectIndex],
                    ),
                 }))
               : []
            t.macros = t.macros
               ? Object.values(t.macros).map((m) => ({
                    uuid: asString(m.uuid),
                    name: asString(m.name),
                    img: cleanPath(m.img),
                    invalid: String(m.invalid) === "true",
                 }))
               : []
            t.scripts = t.scripts
               ? Object.values(t.scripts).map((s) => ({
                    code: asString(s.code),
                 }))
               : []
            t.damages = t.damages
               ? Object.values(t.damages).map((d, damageIndex) => ({
                    diceNum: parseInt(d.diceNum) || 0,
                    diceStep: asString(d.diceStep),
                    dmgType: asString(d.dmgType),
                    dmgCategory: asString(d.dmgCategory),
                    targets: cleanTargets(
                       d,
                       currentThreshold.damages?.[damageIndex],
                    ),
                 }))
               : []
            t.ruleElements = t.ruleElements
               ? Object.values(t.ruleElements).map((r, ruleIndex) => ({
                    json: asString(r.json),
                    invalid: String(r.invalid) === "true",
                    durationValue: parseInt(r.durationValue) || null,
                    durationUnit: asString(r.durationUnit) || "",
                    customDescription: asString(r.customDescription),
                    targets: cleanTargets(
                       r,
                       currentThreshold.ruleElements?.[ruleIndex],
                    ),
                 }))
               : []
            return t
         },
      )
   } else {
      updatedPart.thresholds = []
   }

   this.workingParts[index] = updatedPart
}
