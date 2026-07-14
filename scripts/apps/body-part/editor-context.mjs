import {
   MODULE_ID,
   buildPf2eConditions,
   buildPf2eDamageTypes,
   buildPf2eIwrTypes,
   PF2E_VALUED_CONDITIONS,
} from "../../constants.mjs"
import {
   getActorBaseAc,
   getActorSaveMod,
   getDefaultBodyPartIcon,
   getRntThresholdTargetData,
   getRntThresholdTargetOptions,
   getRntLinkableModuleData,
   isSiegeComponentAction,
   isSiegeVehicleActor,
   normalizeRntSiegeComponentLinks,
   normalizeRntThresholdTargets,
} from "../../actor-support.mjs"
import { formatIwrStr, getActorIwrFallback } from "./common.mjs"

export async function prepareBodyPartEditorContext(options) {
      if (!this.workingParts) {
         this.workingParts = foundry.utils.deepClone(
            this.actor.getFlag(MODULE_ID, "parts") || [],
         )
      }

      const part = foundry.utils.deepClone(
         this.workingParts.find((p) => p.id === this.partId) || {},
      )
      part.linkedItems = part.linkedItems || []
      part.linkedEntries = part.linkedEntries || []
      part.linkedSpells = part.linkedSpells || []
      part.linkedModules = part.linkedModules || []
      part.thresholds = part.thresholds || []

      const fallback = getActorIwrFallback(this.actor)
      part.iwr = part.iwr || {
         ...fallback,
         immuneExc: "",
         weakExc: "",
         resistExc: "",
      }
      part.img = part.img || getDefaultBodyPartIcon(this.actor)

      const baseFort = getActorSaveMod(this.actor, "fortitude")
      const baseRef = getActorSaveMod(this.actor, "reflex")
      const baseWill = getActorSaveMod(this.actor, "will")

      if (!part.saves) {
         part.saves = {
            fortitude: { enabled: false, adjustment: 0 },
            reflex: { enabled: false, adjustment: 0 },
            will: { enabled: false, adjustment: 0 },
         }
      } else {
         for (const k of ["fortitude", "reflex", "will"]) {
            part.saves[k] = part.saves[k] || { enabled: false, adjustment: 0 }

            if (
               part.saves[k].adjustment === undefined &&
               part.saves[k].value !== undefined
            ) {
               const base =
                  k === "fortitude"
                     ? baseFort
                     : k === "reflex"
                       ? baseRef
                       : baseWill
               part.saves[k].adjustment = part.saves[k].value - base
            }
            part.saves[k].adjustment = part.saves[k].adjustment || 0
         }
      }

      const pf2eConditions = buildPf2eConditions()
      const pf2eIWRTypes = buildPf2eIwrTypes()
      const pf2eDamageTypes = buildPf2eDamageTypes()

      if (!pf2eIWRTypes.find((t) => t.slug === "all-damage")) {
         pf2eIWRTypes.unshift({
            slug: "all-damage",
            label:
               game.i18n.localize("pf2e-aztecs-rip-n-tear.allDamage") ||
               "All Damage",
         })
      }

      const parseIWR = (str) => {
         if (!str) return []
         return str
            .split(",")
            .map((s) => {
               let exceptions = []
               let mainPart = s
               if (s.includes(" except ")) {
                  const splitExc = s.split(" except ")
                  mainPart = splitExc[0]
                  exceptions = splitExc[1]
                     .trim()
                     .split(" ")
                     .filter((e) => e)
               }
               const strings = mainPart
                  .trim()
                  .toLowerCase()
                  .split(" ")
                  .filter((x) => x)
               const type = strings[0]
               const value = parseInt(strings[1]) || null
               if (!type) return null
               const found = pf2eIWRTypes.find((x) => x.slug === type)
               let label = found ? found.label : type
               if (exceptions.length) {
                  const excLabels = exceptions.map(
                     (e) => pf2eIWRTypes.find((x) => x.slug === e)?.label || e,
                  )
                  label += ` (except ${excLabels.join(", ")})`
               }
               if (value) label += ` ${value}`
               return { type, value, exceptions, label, raw: s.trim() }
            })
            .filter((x) => x)
      }

      const parseExceptions = (str) => {
         if (!str) return []
         return str
            .split(",")
            .map((s) => {
               const raw = s.trim()
               const found = pf2eIWRTypes.find(
                  (x) => x.slug === raw.toLowerCase(),
               )
               return { label: found ? found.label : raw, raw: raw }
            })
            .filter((x) => x.raw)
      }

      part.iwrData = {
         immune: parseIWR(part.iwr.immune),
         weak: parseIWR(part.iwr.weak),
         resist: parseIWR(part.iwr.resist),
         immuneExc: parseExceptions(part.iwr.immuneExc),
         weakExc: parseExceptions(part.iwr.weakExc),
         resistExc: parseExceptions(part.iwr.resistExc),
      }

      part.acceptedDmgTypes = Array.isArray(part.acceptedDmgTypes)
         ? part.acceptedDmgTypes.filter((t) => t)
         : []
      const acceptedDmgTypeChips = part.acceptedDmgTypes.map((slug) => {
         const dt = pf2eDamageTypes.find((t) => t.slug === slug)
         return { slug, label: dt ? dt.label : slug }
      })
      const availableAcceptedDmgTypes = pf2eDamageTypes.filter(
         (dt) => !part.acceptedDmgTypes.includes(dt.slug),
      )

      part.disableRegenDmgTypes = Array.isArray(part.disableRegenDmgTypes)
         ? part.disableRegenDmgTypes.filter((t) => t)
         : []
      const disableRegenChips = part.disableRegenDmgTypes.map((slug) => {
         const dt = pf2eDamageTypes.find((t) => t.slug === slug)
         return { slug, label: dt ? dt.label : slug }
      })
      const availableDisableRegenDmgTypes = pf2eDamageTypes.filter(
         (dt) => !part.disableRegenDmgTypes.includes(dt.slug),
      )

      const allParts = this.workingParts
      part.dependentParts = allParts
         .filter(
            (other) =>
               other.id !== part.id &&
               other.thresholds?.some((t) => t.linkedParts?.includes(part.id)),
         )
         .map((other) => ({ id: other.id, name: other.name }))

      const showLinkedModules = isSiegeVehicleActor(this.actor)
      const thresholdTargetOptions = showLinkedModules
         ? getRntThresholdTargetOptions(this.actor)
         : []
      const prepareTargetedEntry = (entry) => {
         entry.targets = normalizeRntThresholdTargets(entry.targets)
         entry.targetData = getRntThresholdTargetData(
            this.actor,
            entry.targets,
         )
      }

      part.thresholds.forEach((t) => {
         t.linkedParts = t.linkedParts || []
         t.linkedPartsData = t.linkedParts.map((id) => {
            const lp = allParts.find((x) => x.id === id)
            return lp
               ? { id, name: lp.name }
               : {
                    id,
                    name: game.i18n.localize(
                       "pf2e-aztecs-rip-n-tear.unknownPart",
                    ),
                 }
         })
         t.conditions = t.conditions || []
         t.effects = t.effects || []
         t.macros = t.macros || []
         t.scripts = t.scripts || []
         t.damages = t.damages || []
         t.ruleElements = t.ruleElements || []
         t.disableModules = !!t.disableModules
         t.modifyVehicleLoadCapacity = !!t.modifyVehicleLoadCapacity
         t.vehicleLoadCapacityModifier =
            Number(t.vehicleLoadCapacityModifier) || 0
         t.modifyVehicleSpeed = !!t.modifyVehicleSpeed
         t.vehicleSpeedModifier = Number(t.vehicleSpeedModifier) || 0
         t.conditions.forEach(
            (c) => {
               c.hasValue = PF2E_VALUED_CONDITIONS.includes(c.slug)
               prepareTargetedEntry(c)
            },
         )
         t.effects.forEach(prepareTargetedEntry)
         t.damages.forEach(prepareTargetedEntry)
         t.ruleElements.forEach(prepareTargetedEntry)
      })

      const showSpellcastingLinks = !showLinkedModules
      if (showLinkedModules) {
         const migratedLinks = normalizeRntSiegeComponentLinks(this.actor, [
            part,
         ])
         if (migratedLinks) {
            const workingPart = this.workingParts.find(
               (p) => p.id === this.partId,
            )
            if (workingPart) {
               workingPart.linkedItems = part.linkedItems
               workingPart.linkedModules = part.linkedModules
               workingPart.thresholds = part.thresholds
            }
         }
      }

      const allItems = this.actor.items
      const linkedItemsData = part.linkedItems.map((id) => {
         if (id === "ALL_SPELLCASTING") {
            if (!showSpellcastingLinks) return null
            return {
               id,
               name: game.i18n.localize("pf2e-aztecs-rip-n-tear.spellcasting"),
               icon: "fa-wand-magic-sparkles",
            }
         }
         const item = allItems.get(id)
         return {
            id,
            name: item
               ? item.name
               : game.i18n.localize(`${MODULE_ID}.unknownItem`),
            icon: "fa-suitcase",
         }
      }).filter(Boolean)

      if (showSpellcastingLinks) {
         part.linkedEntries.forEach((id) => {
            const item = allItems.get(id)
            if (item)
               linkedItemsData.push({
                  id,
                  name: item.name,
                  icon: "fa-book-sparkles",
               })
         })

         part.linkedSpells.forEach((id) => {
            const item = allItems.get(id)
            if (item)
               linkedItemsData.push({
                  id,
                  name: item.name,
                  icon: "fa-wand-magic-sparkles",
               })
         })
      }

      const unlinkedItems = allItems.filter(
         (i) =>
            !part.linkedItems.includes(i.id) &&
            !part.linkedModules.includes(i.id),
      )
      const attacks = unlinkedItems.filter(
         (i) => i.type === "melee" || i.type === "weapon",
      )
      const abilities = unlinkedItems.filter(
         (i) =>
            !isSiegeComponentAction(i) &&
            i.type === "action" &&
            ["action", "reaction", "free"].includes(i.system.actionType?.value),
      )
      const passives = unlinkedItems.filter(
         (i) =>
            !isSiegeComponentAction(i) &&
            i.type === "action" &&
            i.system.actionType?.value === "passive",
      )

      const installedModuleData = showLinkedModules
         ? getRntLinkableModuleData(this.actor)
         : []
      const linkedModulesData = part.linkedModules.map((id) => {
         const moduleData = installedModuleData.find((m) => m.id === id)
         const item = this.actor.items.get(id)
         return {
            id,
            name:
               moduleData?.name ||
               item?.name ||
               game.i18n.localize(`${MODULE_ID}.unknownItem`),
            img: moduleData?.img || item?.img || "icons/svg/cogs.svg",
            slotKind: moduleData?.slotKind || "",
            moduleType: moduleData?.moduleType || "",
            active: moduleData?.active,
            disabled: moduleData?.disabled,
         }
      })
      const availableModules = installedModuleData.filter(
         (moduleData) => !part.linkedModules.includes(moduleData.id),
      )

      return {
         actor: this.actor,
         actorBaseAc: getActorBaseAc(this.actor),
         actorBaseSaves: {
            fortitude: baseFort,
            reflex: baseRef,
            will: baseWill,
         },
         part,
         parts: allParts,
         linkedItemsData,
         linkedModulesData,
         availableModules,
         showLinkedModules,
         showThresholdTargets: showLinkedModules,
         thresholdTargetOptions,
         showSpellcastingLinks,
         showVehicleThresholdModifiers: showLinkedModules,
         attacks,
         abilities,
         passives,
         pf2eConditions,
         pf2eDamageTypes,
         pf2eIWRTypes,
         acceptedDmgTypeChips,
         availableAcceptedDmgTypes,
         disableRegenChips,
         availableDisableRegenDmgTypes,
      }
}
