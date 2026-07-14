export function getActorBaseAc(actor) {
   return Number(
      actor?.system?.attributes?.ac?.value ??
         actor?.attributes?.ac?.value ??
         actor?.system?.ac?.value ??
         0,
   )
}

export function getActorHpValue(actor) {
   return Number(
      actor?.system?.attributes?.hp?.value ?? actor?.attributes?.hp?.value ?? 0,
   )
}

export function getActorHpMax(actor) {
   return Number(
      actor?.system?.attributes?.hp?.max ?? actor?.attributes?.hp?.max ?? 0,
   )
}

export function getActorHardness(actor) {
   const systemHardness = actor?.system?.attributes?.hardness
   const actorHardness = actor?.attributes?.hardness
   return Number(
      systemHardness?.value ??
         systemHardness ??
         actorHardness?.value ??
         actorHardness ??
         0,
   )
}

export function getActorSaveMod(actor, saveType) {
   return Number(
      actor?.saves?.[saveType]?.mod ??
         actor?.system?.saves?.[saveType]?.mod ??
         actor?.system?.saves?.[saveType]?.value ??
         0,
   )
}

export function getActorIwrList(actor, key) {
   const value = actor?.system?.attributes?.[key]
   return Array.isArray(value) ? value : []
}

export function getActorItemsByType(actor, type) {
   const typed = actor?.itemTypes?.[type]
   if (Array.isArray(typed)) return typed
   return actor?.items?.filter?.((item) => item.type === type) || []
}
