export function collectTargets(trigger, actorToken, resolvedTriggerer) {
   const targets = []
   if (trigger.target === "triggerer") {
      collectTriggererTarget(targets, trigger, actorToken, resolvedTriggerer)
   } else if (trigger.target === "self") {
      if (actorToken) targets.push(actorToken)
   } else if (trigger.target === "aura") {
      collectAuraTargets(targets, trigger, actorToken)
   }
   return targets
}

function collectTriggererTarget(targets, trigger, actorToken, resolvedTriggerer) {
   if (!resolvedTriggerer) return

   let allowedDistance = 5
   if (
      trigger.triggererDistance !== undefined &&
      trigger.triggererDistance !== null &&
      trigger.triggererDistance !== ""
   ) {
      allowedDistance = parseFloat(trigger.triggererDistance)
   }

   const sourceToken = actorToken?.object || canvas.tokens?.get(actorToken?.id)
   const targetToken =
      resolvedTriggerer?.object ||
      canvas.tokens?.get(resolvedTriggerer?.id) ||
      resolvedTriggerer
   const actualDistance = tokenDistance(sourceToken, targetToken)
   if (actualDistance <= allowedDistance) targets.push(resolvedTriggerer)
}

function collectAuraTargets(targets, trigger, actorToken) {
   if (!actorToken || !canvas.scene) return
   const sourceToken = actorToken.object || canvas.tokens.get(actorToken.id)
   if (!sourceToken) return

   const tokens = canvas.scene.tokens.filter((tokenDoc) => {
      if (tokenDoc.id === actorToken.id) return false
      const targetToken = tokenDoc.object || canvas.tokens.get(tokenDoc.id)
      if (!targetToken) return false
      return tokenDistance(sourceToken, targetToken) <= trigger.radius
   })

   for (const token of tokens) {
      const isEnemy = token.disposition !== actorToken.disposition
      const isAlly = token.disposition === actorToken.disposition
      if (trigger.targetFilters === "enemies" && isEnemy) targets.push(token)
      else if (trigger.targetFilters === "allies" && isAlly)
         targets.push(token)
      else if (trigger.targetFilters === "all") targets.push(token)
   }
}

function tokenDistance(sourceToken, targetToken) {
   if (!sourceToken || !targetToken) return Infinity
   if (typeof sourceToken.distanceTo === "function")
      return sourceToken.distanceTo(targetToken)

   const boundsA = sourceToken.bounds
   const boundsB = targetToken.bounds
   if (boundsA && boundsB) {
      const dx = Math.max(
         0,
         boundsA.left - boundsB.right,
         boundsB.left - boundsA.right,
      )
      const dy = Math.max(
         0,
         boundsA.top - boundsB.bottom,
         boundsB.top - boundsA.bottom,
      )
      return (
         (Math.max(dx, dy) / canvas.dimensions.size) *
         canvas.dimensions.distance
      )
   }

   const dx = targetToken.x - sourceToken.x
   const dy = targetToken.y - sourceToken.y
   return (
      (Math.sqrt(dx * dx + dy * dy) / canvas.dimensions.size) *
      canvas.dimensions.distance
   )
}
