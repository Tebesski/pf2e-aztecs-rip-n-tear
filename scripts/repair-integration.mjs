import { MODULE_ID } from "./constants.mjs"
import {
   getActorHpMax,
   getActorHpValue,
   getDefaultBodyPartIcon,
   isSiegeVehicleActor,
} from "./actor-support.mjs"
import { applyBodyPartDamage, applyBodyPartHealing } from "./mechanics.mjs"

const { DialogV2 } = foundry.applications.api

const REPAIR_TARGET_TEMPLATE = `modules/${MODULE_ID}/templates/integrations/siege/repair-target-dialog.hbs`
const localize = (key) => game.i18n.localize(`${MODULE_ID}.${key}`)

function percent(value, max) {
   const hpMax = Math.max(0, Number(max) || 0)
   if (hpMax <= 0) return 0
   return Math.clamp(Math.round(((Number(value) || 0) / hpMax) * 100), 0, 100)
}

function bodyParts(vehicle) {
   const parts = vehicle?.getFlag?.(MODULE_ID, "parts")
   return Array.isArray(parts) ? parts : []
}

function repairTargetChoices(vehicle) {
   const vehicleHpValue = getActorHpValue(vehicle)
   const vehicleHpMax = getActorHpMax(vehicle)
   const choices = [
      {
         id: "vehicle",
         type: "vehicle",
         label: vehicle?.name || localize("vehicle"),
         img: vehicle?.img || "icons/svg/mystery-man.svg",
         hpValue: vehicleHpValue,
         hpMax: vehicleHpMax,
         hpPct: percent(vehicleHpValue, vehicleHpMax),
         isVehicle: true,
         checked: true,
         dividerBefore: false,
      },
   ]

   for (const [index, part] of bodyParts(vehicle).entries()) {
      const hpValue = Number(part?.hp?.value) || 0
      const hpMax = Number(part?.hp?.max) || 0
      choices.push({
         id: `part:${part.id}`,
         type: "part",
         partId: part.id,
         label: part.name || localize("newBodyPart"),
         img: part.img || getDefaultBodyPartIcon(vehicle),
         hpValue,
         hpMax,
         hpPct: percent(hpValue, hpMax),
         isVehicle: false,
         checked: false,
         dividerBefore: index === 0,
      })
   }

   return choices
}

async function renderRntTemplate(path, data) {
   const render =
      foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate
   return render(path, data)
}

export function hasVehicleRepairTargets(vehicle) {
   return isSiegeVehicleActor(vehicle) && bodyParts(vehicle).length > 0
}

export async function promptVehicleRepairTarget(vehicle, _options = {}) {
   if (!hasVehicleRepairTargets(vehicle)) return null

   const choices = repairTargetChoices(vehicle)
   const content = await renderRntTemplate(REPAIR_TARGET_TEMPLATE, { choices })
   const result = await DialogV2.wait({
      classes: ["pf2e", "rnt-app-v2", "rnt-siege-theme", "rnt-repair-target-dialog"],
      window: { title: localize("repairTargetTitle") },
      content,
      buttons: [
         {
            action: "choose",
            label: localize("repairTargetChoose"),
            icon: "fa-solid fa-hammer",
            default: true,
            callback: (_event, button, dialog) => {
               const root = dialog?.element || button?.form || document
               const selected = root.querySelector(
                  'input[name="rnt-repair-target"]:checked',
               )?.value
               return choices.find((choice) => choice.id === selected) || false
            },
         },
         {
            action: "cancel",
            label: localize("cancel"),
            callback: () => false,
         },
      ],
   }).catch(() => false)

   return result || false
}

async function applySiegeRepairResultLocal(vehicle, target, result) {
   if (!target || target.type !== "part") return false

   const amount = Number(result.amount) || 0
   if (amount <= 0) return false

   if (result.kind === "heal") {
      await applyBodyPartHealing(vehicle, target.partId, amount, {
         suppressChat: true,
      })
      return true
   }

   if (result.kind === "damage") {
      await applyBodyPartDamage(
         vehicle,
         target.partId,
         amount,
         "untyped",
         "",
         0,
         true,
         new Set(),
         { suppressChat: true },
      )
      return true
   }

   return false
}

export async function gmApplySiegeRepairResult(payload = {}) {
   const vehicle = payload.vehicleUuid
      ? await fromUuid(payload.vehicleUuid).catch(() => null)
      : null
   if (!vehicle) return false
   return applySiegeRepairResultLocal(vehicle, payload.target, payload.result)
}

export async function applySiegeRepairResult(
   vehicle,
   target,
   result,
   _context = {},
) {
   if (!target || target.type !== "part") return false
   if (!["heal", "damage"].includes(result?.kind)) return false

   const payload = {
      vehicleUuid: vehicle?.uuid || null,
      target: foundry.utils.deepClone(target),
      result: foundry.utils.deepClone(result),
   }

   if (game.user.isGM) return gmApplySiegeRepairResult(payload)

   if (!globalThis.ripAndTearSocket) {
      ui.notifications.error(localize("socketlibRequired"))
      return false
   }

   return globalThis.ripAndTearSocket.executeAsGM(
      "applySiegeRepairResult",
      payload,
   )
}
