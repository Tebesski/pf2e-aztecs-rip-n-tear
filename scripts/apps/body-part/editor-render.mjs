import { MODULE_ID } from "../../constants.mjs"
import { normalizeRntThresholdTargets } from "../../actor-support.mjs"
import {
   renderEffectContentLink,
   renderInvalidEffectLabel,
   renderPendingEffectLabel,
} from "../effect-link-renderer.mjs"

export function activateBodyPartEditorRender(context, options) {
      const summaries = this.element.querySelectorAll("summary")
      summaries.forEach((summary) => {
         summary.addEventListener("click", (ev) => {
            const interactive = ev.target.closest(
               "input, select, button, a[data-action], label",
            )
            if (interactive && !ev.target.closest(".rnt-chevron-orange")) {
               const details = summary.parentElement
               const wasOpen = details.hasAttribute("open")
               requestAnimationFrame(() => {
                  if (wasOpen) details.setAttribute("open", "")
                  else details.removeAttribute("open")
               })
            }
         })
      })

      if (this._accordionStates) {
         this.element.querySelectorAll("details").forEach((d) => {
            let key = d.dataset.section
            if (!key && d.dataset.threshold !== undefined)
               key = `threshold-${d.dataset.threshold}`
            if (key && this._accordionStates.has(key)) {
               if (this._accordionStates.get(key)) d.setAttribute("open", "")
               else d.removeAttribute("open")
            }
         })
      }

      const html = this.element
      const acInputs = html.querySelectorAll(".rnt-ac-adj-input")

      acInputs.forEach((input) => {
         const display = input.nextElementSibling
         if (!display || !display.classList.contains("rnt-ac-total-display"))
            return

         const baseAc = Number(input.dataset.baseAc) || 0
         const oldAc =
            input.dataset.oldAc !== "" ? Number(input.dataset.oldAc) : NaN

         if (input.value === "" && !isNaN(oldAc)) {
            input.value = oldAc - baseAc
         }

         const updateDisplay = () => {
            const adj = Number(input.value) || 0
            display.textContent = ` = ${baseAc + adj} AC`
         }

         input.addEventListener("input", updateDisplay)
         updateDisplay()
      })

      if (this._savedScrollPos !== undefined) {
         const restore = () => {
            const scrollable = this.element?.querySelector(".rnt-scrollable")
            if (scrollable && scrollable.isConnected) {
               scrollable.scrollTop = this._savedScrollPos
            }
         }
         restore()
         requestAnimationFrame(() => requestAnimationFrame(restore))
         setTimeout(restore, 50)
      }

      const reRenderOnChange = async () => {
         await this._saveCurrentState()
         this._saveViewState()
         this.render()
      }

      const useRuptureCheck = this.element.querySelector(
         'input[name="useRupture"]',
      )
      if (useRuptureCheck) {
         useRuptureCheck.addEventListener("change", reRenderOnChange)
      }

      this.element.querySelectorAll(".item-link").forEach((el) => {
         el.addEventListener("click", async (ev) => {
            const id = ev.currentTarget.dataset.id
            const item = this.actor.items.get(id)
            if (item) item.sheet.render(true)
         })
      })

      this.element
         .querySelectorAll('input[type="checkbox"][name^="saves."]')
         .forEach((cb) => {
            cb.addEventListener("change", (e) => {
               const wrapper = e.target.closest(
                  ".rnt-save-inline, .rnt-save-row",
               )
               const numInput = wrapper?.querySelector('input[type="number"]')
               const display = wrapper?.querySelector(".rnt-save-total-display")

               if (numInput && wrapper) {
                  if (e.target.checked) {
                     wrapper.classList.add("rnt-save-active")
                     const currentVal = parseInt(numInput.value, 10)
                     if (isNaN(currentVal)) numInput.value = 0
                     numInput.dispatchEvent(new Event("input"))
                  } else {
                     wrapper.classList.remove("rnt-save-active")
                     if (display) display.textContent = ""
                  }
               }
            })
         })

      this.element.querySelectorAll(".rnt-save-adj-input").forEach((input) => {
         const display = input.nextElementSibling
         if (!display || !display.classList.contains("rnt-save-total-display"))
            return

         const baseSave = Number(input.dataset.baseSave) || 0
         const wrapper = input.closest(".rnt-save-inline, .rnt-save-row")
         const cb = wrapper?.querySelector('input[type="checkbox"]')

         const updateDisplay = () => {
            if (cb && !cb.checked) {
               display.textContent = ""
               return
            }

            const adj = Number(input.value) || 0
            const total = baseSave + adj
            display.textContent = ` = ${total >= 0 ? "+" : ""}${total}`
         }

         input.addEventListener("input", updateDisplay)
         updateDisplay()
      })

      this.element.addEventListener("click", async (ev) => {
         const effectLink = ev.target.closest(".rnt-effect-link")
         if (effectLink) {
            const uuid = effectLink.dataset.uuid
            const item = await fromUuid(uuid)
            if (item) item.sheet.render(true)
         }
      })

      const dealsDmgCheck = this.element.querySelector(
         'input[name="dealsDamage"]',
      )
      if (dealsDmgCheck) {
         dealsDmgCheck.addEventListener("change", async (ev) => {
            const grp = this.element.querySelector(".rnt-persistent-dmg-group")
            if (grp) grp.style.display = ev.target.checked ? "flex" : "none"
            const failGrp = this.element.querySelector(
               ".rnt-failed-rupture-group",
            )
            if (failGrp)
               failGrp.style.display = ev.target.checked ? "flex" : "none"
            await this._saveCurrentState()
         })
      }

      const abilitySelect = this.element.querySelector(".rnt-ability-select")
      if (abilitySelect) {
         abilitySelect.addEventListener("change", async (ev) => {
            const id = ev.currentTarget.value
            if (!id) return
            await this._saveCurrentState()
            const part = this.workingParts.find((p) => p.id === this.partId)
            part.linkedItems = part.linkedItems || []
            if (!part.linkedItems.includes(id)) part.linkedItems.push(id)
            this._saveViewState()
            this.render()
         })
      }

      const moduleSelect = this.element.querySelector(".rnt-module-select")
      if (moduleSelect) {
         moduleSelect.addEventListener("change", async (ev) => {
            const id = ev.currentTarget.value
            if (!id) return
            await this._saveCurrentState()
            const part = this.workingParts.find((p) => p.id === this.partId)
            part.linkedModules = part.linkedModules || []
            if (!part.linkedModules.includes(id)) part.linkedModules.push(id)
            this._saveViewState()
            this.render()
         })
      }

      this.element
         .querySelectorAll(".rnt-condition-select")
         .forEach((el) => el.addEventListener("change", reRenderOnChange))

      this.element
         .querySelectorAll(".rnt-threshold-part-select")
         .forEach((el) => {
            el.addEventListener("change", async (ev) => {
               const val = ev.target.value
               const ti = ev.target.dataset.ti
               if (!val) return
               await this._saveCurrentState()
               const part = this.workingParts.find((p) => p.id === this.partId)
               if (!part.thresholds[ti].linkedParts.includes(val)) {
                  part.thresholds[ti].linkedParts.push(val)
                  this._saveViewState()
                  this.render()
               }
            })
         })

      this.element
         .querySelectorAll(".rnt-threshold-target-select")
         .forEach((el) => {
            el.addEventListener("change", async (ev) => {
               const val = ev.target.value
               const ti = parseInt(ev.target.dataset.ti, 10)
               const kind = ev.target.dataset.kind
               const entryIndex = parseInt(ev.target.dataset.entryIndex, 10)
               if (!val || !kind || !Number.isInteger(ti)) return
               await this._saveCurrentState()
               const part = this.workingParts.find((p) => p.id === this.partId)
               const entry = part?.thresholds?.[ti]?.[kind]?.[entryIndex]
               if (!entry) return
               entry.targets = normalizeRntThresholdTargets(entry.targets)
               if (!entry.targets.includes(val)) {
                  entry.targets.push(val)
                  this._saveViewState()
                  this.render()
               }
            })
         })

      this.element
         .querySelectorAll(".rnt-dependent-part-link")
         .forEach((el) => {
            el.addEventListener("click", (ev) => {
               ev.preventDefault()
               const partId = ev.currentTarget.dataset.partId
               new this.constructor({ actor: this.actor, partId }).render(true)
            })
         })

      this.element.querySelectorAll(".rnt-effect-uuid-input").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            const uuid = ev.currentTarget.value
            const parent = ev.currentTarget.closest(".effect-entry")
            const iconEl = parent.querySelector(".effect-icon")
            const nameEl = parent.querySelector(".effect-name-container")

            if (!uuid) {
               iconEl.src = "icons/svg/mystery-man.svg"
               nameEl.innerHTML = await renderPendingEffectLabel()
               parent.querySelector('input[name$=".invalid"]').value = "false"
               await this._saveCurrentState()
               return
            }

            const item = await fromUuid(uuid)
            if (
               !item ||
               (item.type !== "effect" && item.documentName !== "Macro")
            ) {
               iconEl.src = "icons/svg/hazard.svg"
               nameEl.innerHTML = await renderInvalidEffectLabel()
               parent.querySelector('input[name$=".invalid"]').value = "true"
               parent.querySelector('input[name$=".name"]').value =
                  game.i18n.localize(`${MODULE_ID}.invalidItem`)
               parent.querySelector('input[name$=".img"]').value =
                  "icons/svg/hazard.svg"
            } else {
               iconEl.src = item.img || "icons/svg/dice-target.svg"
               nameEl.innerHTML = await renderEffectContentLink(item, uuid)
               parent.querySelector('input[name$=".invalid"]').value = "false"
               parent.querySelector('input[name$=".name"]').value = item.name
               parent.querySelector('input[name$=".img"]').value =
                  item.img || "icons/svg/dice-target.svg"
            }
            await this._saveCurrentState()
         })
      })

      this.element
         .querySelectorAll('select[name$=".dmgType"]')
         .forEach((el) => {
            el.addEventListener("change", async (ev) => {
               const val = ev.currentTarget.value
               if (val === "bleed") {
                  const row = ev.currentTarget.closest(
                     ".rnt-damage-row, .rnt-damage-row-flat, .flexrow",
                  )
                  const catSelect = row?.querySelector(
                     'select[name$=".dmgCategory"]',
                  )
                  if (catSelect) catSelect.value = "persistent"
               }
               await this._saveCurrentState()
            })
         })

      this.element.querySelectorAll(".rnt-re-json-input").forEach((el) => {
         el.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            const parent = ev.currentTarget.closest(".re-entry")
            try {
               if (val.trim() === "") throw new Error("Empty")
               JSON.parse(val)
               parent.querySelector('input[name$=".invalid"]').value = "false"
               ev.currentTarget.style.borderColor = "green"
            } catch (e) {
               parent.querySelector('input[name$=".invalid"]').value = "true"
               ev.currentTarget.style.borderColor = "red"
               ui.notifications.warn(
                  game.i18n.localize(`${MODULE_ID}.invalidJson`),
               )
            }
            await this._saveCurrentState()
         })
      })

      const customIWR = this.element.querySelector('input[name="customIWR"]')
      if (customIWR) {
         customIWR.addEventListener("change", reRenderOnChange)
      }

      this.element
         .querySelector('select[name="acceptedDmgTypesSelect"]')
         ?.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            if (!val) return
            await this._saveCurrentState()
            const part = this.workingParts.find((p) => p.id === this.partId)
            if (!part.acceptedDmgTypes) part.acceptedDmgTypes = []
            if (!part.acceptedDmgTypes.includes(val)) {
               part.acceptedDmgTypes.push(val)
               this._saveViewState()
               this.render()
            }
         })

      this.element
         .querySelector('select[name="disableRegenDmgTypesSelect"]')
         ?.addEventListener("change", async (ev) => {
            const val = ev.currentTarget.value
            if (!val) return
            await this._saveCurrentState()
            const part = this.workingParts.find((p) => p.id === this.partId)
            if (!part.disableRegenDmgTypes) part.disableRegenDmgTypes = []
            if (!part.disableRegenDmgTypes.includes(val)) {
               part.disableRegenDmgTypes.push(val)
               this._saveViewState()
               this.render()
            }
         })

      const setupIWRSelect = (id, field) => {
         this.element
            .querySelector(id)
            ?.addEventListener("change", async (ev) => {
               const val = ev.currentTarget.value
               if (!val) return
               let valNum = ""
               if (field === "weak" || field === "resist") {
                  valNum =
                     this.element.querySelector(`#rnt-${field}-value`)?.value ||
                     "5"
               }
               await this._saveCurrentState()
               const parts = this._getParts()
               const part = parts.find((p) => p.id === this.partId)
               if (!part.iwr) part.iwr = {}
               let arr = part.iwr[field]
                  ? part.iwr[field]
                       .split(",")
                       .map((s) => s.trim())
                       .filter((s) => s)
                  : []

               let str = val
               if (valNum) str += ` ${valNum}`

               if (!arr.includes(str)) arr.push(str)
               part.iwr[field] = arr.join(", ")
               await this.actor.setFlag(
                  "pf2e-aztecs-rip-n-tear",
                  "parts",
                  parts,
               )
               this._saveViewState()
               this.render()
            })
      }

      setupIWRSelect("#rnt-immune-select", "immune")
      setupIWRSelect("#rnt-weak-select", "weak")
      setupIWRSelect("#rnt-resist-select", "resist")
      setupIWRSelect("#rnt-immune-exc-select", "immuneExc")
      setupIWRSelect("#rnt-weak-exc-select", "weakExc")
      setupIWRSelect("#rnt-resist-exc-select", "resistExc")
}
