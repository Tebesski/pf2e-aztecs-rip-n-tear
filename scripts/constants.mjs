export const MODULE_ID = "pf2e-aztecs-rip-n-tear"

export const SFX_KEYS = {
   damage: "sfxVolumeBodyPartDamage",
   heal: "sfxVolumeBodyPartHeal",
   destroy: "sfxVolumeBodyPartDestroyed",
   damageReaction: "sfxVolumeDamageReaction",
   deathReaction: "sfxVolumeDeathReaction",
}

export const PF2E_CONDITION_SLUGS = [
   "blinded",
   "broken",
   "clumsy",
   "concealed",
   "confused",
   "controlled",
   "dazzled",
   "deafened",
   "doomed",
   "drained",
   "dying",
   "encumbered",
   "enfeebled",
   "fascinated",
   "fatigued",
   "fleeing",
   "frightened",
   "grabbed",
   "hidden",
   "immobilized",
   "invisible",
   "observed",
   "off-guard",
   "paralyzed",
   "persistent-damage",
   "petrified",
   "prone",
   "quickened",
   "restrained",
   "ruined",
   "sickened",
   "slowed",
   "stunned",
   "stupefied",
   "unconscious",
   "undetected",
   "wounded",
]

export const PF2E_VALUED_CONDITIONS = [
   "clumsy",
   "doomed",
   "drained",
   "enfeebled",
   "frightened",
   "sickened",
   "slowed",
   "stunned",
   "stupefied",
]

export const PF2E_BASE_DAMAGE_TYPES = {
   acid: "Acid",
   bludgeoning: "Bludgeoning",
   cold: "Cold",
   electricity: "Electricity",
   fire: "Fire",
   force: "Force",
   mental: "Mental",
   piercing: "Piercing",
   poison: "Poison",
   slashing: "Slashing",
   bleed: "Bleed",
   sonic: "Sonic",
   vitality: "Vitality",
   void: "Void",
}

export const PF2E_IWR_TYPES = [
   "abysium",
   "acid",
   "adamantine",
   "aging",
   "air",
   "alchemical",
   "arcane",
   "area-damage",
   "auditory",
   "bleed",
   "blinded",
   "bludgeoning",
   "clumsy",
   "cold",
   "cold-iron",
   "confused",
   "controlled",
   "critical-hits",
   "curse",
   "dawnsilver",
   "dazzled",
   "deafened",
   "death-effects",
   "detection",
   "disease",
   "divine",
   "djezet",
   "doomed",
   "drained",
   "duskwood",
   "earth",
   "electricity",
   "emotion",
   "energy",
   "enfeebled",
   "fascinated",
   "fatigued",
   "fear-effects",
   "fire",
   "fleeing",
   "force",
   "fortune-effects",
   "frightened",
   "grabbed",
   "healing",
   "holy",
   "illusion",
   "immobilized",
   "inhaled",
   "inubrix",
   "light",
   "magic",
   "mental",
   "metal",
   "misfortune-effects",
   "non-magical",
   "nonlethal-attacks",
   "noqual",
   "object-immunities",
   "occult",
   "off-guard",
   "olfactory",
   "orichalcum",
   "paralyzed",
   "peachwood",
   "persistent-damage",
   "petrified",
   "physical",
   "piercing",
   "plant",
   "poison",
   "polymorph",
   "possession",
   "precision",
   "prediction",
   "primal",
   "prone",
   "radiation",
   "restrained",
   "salt-water",
   "scrying",
   "siccatite",
   "sickened",
   "silver",
   "slashing",
   "sleep",
   "slowed",
   "sonic",
   "spell-deflection",
   "spirit",
   "stunned",
   "stupefied",
   "swarm-attacks",
   "swarm-mind",
   "time",
   "trip",
   "unarmed-attacks",
   "unconscious",
   "unholy",
   "visual",
   "vitality",
   "void",
   "water",
   "wood",
   "wounded",
]

export const PHYSICAL_TYPES = ["bludgeoning", "piercing", "slashing", "bleed"]
export const ENERGY_TYPES = [
   "acid",
   "cold",
   "electricity",
   "fire",
   "sonic",
   "force",
   "vitality",
   "void",
   "positive",
   "negative",
]

export function buildPf2eConditions() {
   return PF2E_CONDITION_SLUGS.map((slug) => ({
      slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1).replace("-", " "),
      hasValue: PF2E_VALUED_CONDITIONS.includes(slug),
   }))
}

export function buildPf2eDamageTypes() {
   const rawTypes =
      CONFIG.PF2E?.damageTypes ||
      CONFIG.PF2E?.damageTraits ||
      PF2E_BASE_DAMAGE_TYPES
   const types = Object.entries(rawTypes)
      .map(([slug, label]) => ({
         slug,
         label: typeof label === "string" ? game.i18n.localize(label) : slug,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

   if (!types.find((t) => t.slug === "all-damage")) {
      types.unshift({
         slug: "all-damage",
         label:
            game.i18n.localize("pf2e-aztecs-rip-n-tear.allDamage") ||
            "All Damage",
      })
   }

   return types
}

export function buildPf2eIwrTypes() {
   return PF2E_IWR_TYPES.map((slug) => {
      let label = slug
         .split("-")
         .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
         .join(" ")
      if (CONFIG.PF2E) {
         const possibleLabel =
            CONFIG.PF2E.immunityTypes?.[slug] ||
            CONFIG.PF2E.weaknessTypes?.[slug] ||
            CONFIG.PF2E.resistanceTypes?.[slug]
         if (possibleLabel) {
            label =
               typeof possibleLabel === "string"
                  ? game.i18n.localize(possibleLabel)
                  : possibleLabel
         }
      }
      return { slug, label }
   }).sort((a, b) => a.label.localeCompare(b.label))
}
