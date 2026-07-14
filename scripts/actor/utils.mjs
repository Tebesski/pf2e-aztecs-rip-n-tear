export function normalizeIdList(ids) {
   const values =
      ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : []
   return Array.from(
      new Set(
         values.map((id) => String(id || "").trim()).filter((id) => id),
      ),
   )
}

export function numberOrZero(value) {
   const num = Number(value)
   return Number.isFinite(num) ? num : 0
}

export function roundTenth(value) {
   return Math.round(numberOrZero(value) * 10) / 10
}

export function hasOwnKeys(obj) {
   return !!obj && typeof obj === "object" && Object.keys(obj).length > 0
}
