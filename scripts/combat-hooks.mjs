import { setupSavingThrowHook } from "./combat/save-hook.mjs"
import { setupPreCreateChatMessageHook } from "./combat/pre-create-chat.mjs"
import { setupRenderChatMessageHook } from "./combat/render-chat.mjs"
import { setupCombatTurnHook } from "./combat/turn-hook.mjs"

export function registerCombatHooks() {
   const originalCheckRoll = game.pf2e.Check.roll
   setupSavingThrowHook(originalCheckRoll)
   setupPreCreateChatMessageHook()
   setupRenderChatMessageHook()
   setupCombatTurnHook()
}
