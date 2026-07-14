window.RNT_EXPANDED = window.RNT_EXPANDED || new Set()
window.RNT_SCROLL_POS = window.RNT_SCROLL_POS || new Map()

if (!window.RNT_SCROLL_TRACKER_INSTALLED) {
   window.RNT_SCROLL_TRACKER_INSTALLED = true
   document.addEventListener(
      "scroll",
      (ev) => {
         const target = ev.target
         if (!target || target === document) return
         if (!target.classList) return
         const appEl = target.closest?.(
            ".app.sheet, .application.sheet, [data-rnt-actor-uuid]",
         )
         if (!appEl) return
         const actorUuid = appEl.dataset?.rntActorUuid
         if (!actorUuid) return
         const scrollKey = buildScrollKey(target, appEl)
         if (!scrollKey) return
         const map = window.RNT_SCROLL_POS.get(actorUuid) || new Map()
         map.set(scrollKey, target.scrollTop)
         window.RNT_SCROLL_POS.set(actorUuid, map)
      },
      true,
   )
}

function buildScrollKey(el, root) {
   const parts = []
   let cur = el
   while (cur && cur !== root && cur !== document) {
      const tag = cur.tagName?.toLowerCase() || ""
      const id = cur.id ? `#${cur.id}` : ""
      const cls = cur.classList?.length
         ? "." + Array.from(cur.classList).slice(0, 4).join(".")
         : ""
      const tab = cur.dataset?.tab ? `[data-tab="${cur.dataset.tab}"]` : ""
      parts.unshift(`${tag}${id}${cls}${tab}`)
      cur = cur.parentElement
   }
   return parts.join(" > ")
}

function resolveScrollKey(key, root) {
   const segments = key.split(" > ")
   let cur = root
   for (let i = 0; i < segments.length && cur; i++) {
      if (i === 0) continue
      const sel = segments[i]
      let match = null
      try {
         match = cur.querySelector(":scope > " + sel)
      } catch (_e) {}
      if (!match) {
         try {
            match = cur.querySelector(sel)
         } catch (_e) {
            return null
         }
      }
      if (!match) return null
      cur = match
   }
   return cur === root ? null : cur
}

export function restoreActorScrollPositions(actorUuid, rootEl) {
   const map = window.RNT_SCROLL_POS.get(actorUuid)
   if (!map || !rootEl) return
   let attempts = 0
   const restore = () => {
      if (!rootEl.isConnected) return
      for (const [key, top] of map.entries()) {
         if (typeof top !== "number" || top <= 0) continue
         const el = resolveScrollKey(key, rootEl)
         if (el && Math.abs(el.scrollTop - top) > 1) {
            el.scrollTop = top
         }
      }
      attempts++
      if (attempts < 24) requestAnimationFrame(restore)
   }
   restore()
   setTimeout(restore, 50)
   setTimeout(restore, 150)
   setTimeout(restore, 350)
   setTimeout(restore, 700)
   setTimeout(restore, 1200)
}

export function captureActorSheetScroll(actor) {
   if (!actor) return
   const sheets = Object.values(ui.windows).filter(
      (w) => w.actor === actor && typeof w.appId === "number",
   )
   const v2Apps = []
   try {
      for (const a of foundry.applications?.instances?.values?.() || []) {
         if (a?.actor === actor) v2Apps.push(a)
      }
   } catch (_e) {}
   const allSheets = [...sheets, ...v2Apps]
   for (const sheet of allSheets) {
      if (!sheet.element) continue
      const root =
         sheet.element instanceof HTMLElement ? sheet.element : sheet.element[0]
      if (!root) continue
      root.dataset.rntActorUuid = actor.uuid
      const map = window.RNT_SCROLL_POS.get(actor.uuid) || new Map()
      const scrollables = root.querySelectorAll(
         ".sheet-body, .window-content, .tab.active, .tab-content, .scroll-container, [data-tab].active, .actor-main-content",
      )
      for (const el of scrollables) {
         if (el.scrollTop > 0) {
            map.set(buildScrollKey(el, root), el.scrollTop)
         }
      }
      window.RNT_SCROLL_POS.set(actor.uuid, map)
   }
}

