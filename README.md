# PF2e Aztec's Rip & Tear (Until it's done)

This module adds body-part damage tracking and automation, damage reactions and death reactions to NPCs.

---

## Features

### Body Parts

**Add body parts to any NPC. Each part has:**

- HP, AC, Hardness, Saving Throws
- Damage multiplier and behaviour flags
- Rupture mode — only damage equal to or above the part's Maximum HP destroys it
- Accepted Damage Types filter — list which damage types this part actually takes; everything else is ignored
- Immunities/Weaknesses/Resistances override for each Body Part
- SFX — separate sounds for damage, destroy, and heal events and also an asset pack of royalty free SFX of dismemberment! (yay, violence)
- Linked abilities/attacks/spells/body parts — when a body part is destroyed, you can disable abilities/attacks/spells

**You can:**

- Set up Damage Thresholds. Whenever body part's HP reaches a certain Threshold, you can: apply conditions/effects/rule elements; deal damage; execute macros; disable linked abilities
- Deal Persistent Damage to the Body Part
- Set up to deal damage/persistent damage to the NPC's HP upon taking Body Part damage
- Apply an effect to heal body part over time
- Hide the Body Part from players
- Copy the body part
- Export/Import it

### Damage Reactions

Reactions that fire when a body part **and/or** the NPC takes damage.

- Can be either Free action or Reaction; in case with the latter, prompts GM to use the Reaction and applies functional "Reaction used" effect, if was used
- Can react to body-part-only / creature-only / both
- Optional minimum damage filter
- Optional damage type filter
- One or more triggers, each of which can be: deal damage, apply effect/condition, execute macro, or make a branched Saving Throw, where you assign deal damage/apply condition/effect to each of the outcomes
- Saving Throw triggers also include Basic Saving Throw damage set up
- Trigger targets: triggerer, self, or radius with ally/enemy/all filters

### Death Reactions

A single death-trigger configurable per NPC, with optional delay (start/end of turn) and the same trigger system as damage reactions.

### Called Shot UI

When attacking an NPC with body parts, a target picker appears that shows each part's HP/AC and routes the attack — including saves — to the chosen part.

### Templates

You can create RIP & TEAR templates. They are highly configurable and can include any of the module elements. You can also automate it to apply certain templates to NPCs with certain traits.
Example: you have an exploding skeleton NPC with Explosive Death reaction, Flames damage reaction and body parts: two arms, two legs and one skull. When you save it as a template, you can choose to put in a name, check if you want this template to auto-apply to NPCs with a set of traits that you later configure; which of these elements would you like to include (you can exclude any of the elements, for example, you might wish to save this template without Flames damage reaction).
When you save it, it is now easily available through the templates. You can open Template in any NPC and click "Add from Templates", and apply the templates. You can choose to re-apply all of the elements, to add up on top of existing elements.
