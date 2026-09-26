import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BtwController } from '../controller.js'
import { createBtwClaim } from '../input-source.js'

/** The input shell exposes its Lexical editor at runtime; only composition state is read. */
type ComposingEditor = { isComposing?: () => boolean }

export function bindInput(input: SessionInput, controller: BtwController): () => void {
  let active = true, queued = false
  const update = () => {
    if (queued || !active) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!active) return
      // An IME owns the text and the caret while composing. A claim edit here rewrites
      // the composing span, leaves it wearing the command-token colour, and moves the
      // caret onto the token when the composition commits. Wait for it to settle.
      const composing = (input as SessionInput & { editor?: ComposingEditor }).editor?.isComposing?.() === true
      if (composing) return
      const state = input.state.getSnapshot()
      const match = state.phase === 'plain' ? /^\s*(\/btw)(?=\s|$)/i.exec(state.draft) : null
      if (!match || !/\s/.test(state.draft.slice(match[0].length, match[0].length + 1))) return
      const end = /^\s*\/btw\s+/i.exec(state.draft)![0].length
      // Claim only the bare command. Entering command mode rewrites the leading span,
      // and the editor puts the caret at its end; once the user has typed past the
      // token that would steal the caret back to the token. Enter still adjudicates
      // `/btw <question>` through the trigger source.
      if (state.draft.slice(end) !== '') return
      if (state.occurrences.some(o => o.offset < end)) return
      input.beginCommand(createBtwClaim(controller, match[1]), { start: 0, end, draftRev: state.draftRev })
    })
  }
  const unsubscribe = input.state.subscribe(update); update()
  return () => { active = false; unsubscribe() }
}
