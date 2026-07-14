export async function canUseTarget(targetUuid) {
   if (game.user.isGM) return true
   const target =
      globalThis.fromUuidSync?.(targetUuid) ||
      (await fromUuid(targetUuid).catch(() => null))
   const actor = target?.actor || (target?.documentName === "Actor" ? target : null)
   return !!actor?.testUserPermission?.(game.user, "OWNER")
}

export function targetDocsForTargets(targets) {
   const seen = new Set()
   const docs = []
   for (const actor of targets) {
      const active = actor?.getActiveTokens?.() || []
      const token =
         active.find((candidate) => candidate?.document?.uuid)?.document ||
         active.find((candidate) => candidate?.uuid) ||
         actor?.token ||
         null
      const doc = token?.document || token || actor
      if (!doc?.uuid || seen.has(doc.uuid)) continue
      seen.add(doc.uuid)
      docs.push({
         uuid: doc.uuid,
         id: doc.id,
         name: actor?.name || doc.name,
         actor,
         object: doc.object,
      })
   }
   return docs
}

export function targetTokenDocs(targetDocs) {
   try {
      const ids = targetDocs
         .filter((doc) => doc.uuid?.startsWith("Scene."))
         .map((doc) => doc.id)
         .filter(Boolean)
      if (ids.length > 0) game.user.updateTokenTargets(ids)
   } catch (_err) {
   }
}
