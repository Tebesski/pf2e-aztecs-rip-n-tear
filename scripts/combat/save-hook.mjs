import { MODULE_ID } from "../constants.mjs"
import { CalledShotTargetApp } from "../apps/called-shot-app.mjs"
import { getActorBaseAc, getActorSaveMod } from "../actor-support.mjs"
import { getTargetDoc } from "./damage-message.mjs"

export function setupSavingThrowHook(originalCheckRoll) {
   game.pf2e.Check.roll = async function (check, context, event, ...args) {
      const rollActor = context?.actor || this?.actor
      const calledShotsEnabled = game.settings.get(
         MODULE_ID,
         "enableCalledShots",
      )

      if (
         calledShotsEnabled &&
         context?.type === "saving-throw" &&
         !context.rntSaveResolved
      ) {
         const opts = context.options
         let skip = false
         if (opts) {
            if (opts instanceof Set && opts.has("skip-rnt-called-shot"))
               skip = true
            else if (
               Array.isArray(opts) &&
               opts.includes("skip-rnt-called-shot")
            )
               skip = true
         }

         const saveType = context.domains?.find((d) =>
            ["fortitude", "reflex", "will"].includes(d),
         )

         if (!skip && saveType && rollActor) {
            const parts = rollActor.getFlag(MODULE_ID, "parts") || []
            const validPartsWithSave = parts.filter(
               (p) =>
                  (!p.isHidden ||
                     game.user.role >= CONST.USER_ROLES.ASSISTANT) &&
                  p.saves?.[saveType]?.enabled,
            )

            if (validPartsWithSave.some((p) => p.hp.value > 0)) {
               return new Promise((resolve) => {
                  new CalledShotTargetApp({
                     actor: rollActor,
                     parts: validPartsWithSave,
                     isSave: true,
                     saveType,
                     resolve: async (result) => {
                        context.rntSaveResolved = true
                        if (result && result.type === "part") {
                           let diff = result.part.saves[saveType].adjustment

                           if (
                              diff === undefined &&
                              result.part.saves[saveType].value !== undefined
                           ) {
                              diff =
                                 result.part.saves[saveType].value -
                                 getActorSaveMod(rollActor, saveType)
                           }
                           diff = diff || 0

                           const rntMod = new game.pf2e.Modifier({
                              slug: "rnt-body-part-save",
                              label: `${result.part.name} Save Adj`,
                              modifier: diff,
                              type: "untyped",
                           })

                           if (typeof check.push === "function") {
                              check.push(rntMod)
                           } else if (Array.isArray(check.modifiers)) {
                              check.modifiers.push(rntMod)
                           }
                        }
                        resolve(
                           await originalCheckRoll.call(
                              this,
                              check,
                              context,
                              event,
                              ...args,
                           ),
                        )
                     },
                  }).render(true)
               })
            }
         }
      }

      if (
         calledShotsEnabled &&
         context?.type === "attack-roll" &&
         context?.target?.token
      ) {
         const targetTokenDoc = getTargetDoc(context.target.token)
         const parts = targetTokenDoc?.actor?.getFlag(MODULE_ID, "parts") || []
         const validParts = parts.filter(
            (p) => !p.isHidden || game.user.role >= CONST.USER_ROLES.ASSISTANT,
         )

         if (
            parts.length > 0 &&
            validParts.some((p) => p.hp.value > 0) &&
            !context.rntCalledShotResolved
         ) {
            return new Promise((resolve) => {
               new CalledShotTargetApp({
                  actor: targetTokenDoc.actor,
                  parts: validParts,
                  resolve: async (result) => {
                     if (!result) return resolve(null)

                     context.rntCalledShotResolved = true
                     if (result.type === "part") {
                        if (context.options instanceof Set) {
                           context.options.add(`called-shot:${result.part.id}`)
                        } else {
                           context.options = context.options || []
                           context.options.push(`called-shot:${result.part.id}`)
                        }
                        const baseAc = getActorBaseAc(targetTokenDoc.actor)
                        let adj = 0
                        if (
                           result.part.acAdjustment !== undefined &&
                           result.part.acAdjustment !== null &&
                           result.part.acAdjustment !== ""
                        ) {
                           adj = Number(result.part.acAdjustment)
                        } else if (
                           result.part.ac !== undefined &&
                           result.part.ac !== null
                        ) {
                           adj = Number(result.part.ac) - baseAc
                        }
                        context.dc = { value: baseAc + adj }
                     }
                     resolve(
                        await originalCheckRoll.call(
                           this,
                           check,
                           context,
                           event,
                           ...args,
                        ),
                     )
                  },
               }).render(true)
            })
         }
      }
      return originalCheckRoll.call(this, check, context, event, ...args)
   }
}

