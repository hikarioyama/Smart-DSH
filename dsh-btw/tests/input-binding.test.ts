import { describe, it, expect, vi } from 'vitest'
import { bindInput } from '../src/client/compat/input.js'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BtwController } from '../src/client/controller.js'
import type { CommandClaim } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

describe('input adapter boundaries', () => {
  it('claims the bare pasted BTW token after the editor callback and cleans up', async () => {
    let callback = () => {}
    const state = { phase: 'plain', draft: '/btw ', draftRev: 7, occurrences: [] }
    const beginCommand = vi.fn()
    const unsubscribe = vi.fn()
    const input = { state: { getSnapshot: () => state, subscribe: (fn: () => void) => { callback = fn; return unsubscribe } }, beginCommand } as unknown as SessionInput
    const dispose = bindInput(input, { ask: vi.fn() } as unknown as BtwController)
    expect(beginCommand).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(beginCommand).toHaveBeenCalledWith(expect.objectContaining({ token: '/btw ' }), { start: 0, end: 5, draftRev: 7 })
    dispose(); callback(); await Promise.resolve()
    expect(beginCommand).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('leaves text typed past the token alone so the caret is never taken back', async () => {
    for (const draft of ['/btw pasted question', '/btw 一文目です二文目です', '/btw ']) {
      const beginCommand = vi.fn()
      const input = {
        state: { getSnapshot: () => ({ phase: 'plain', draft, draftRev: 3, occurrences: [] }), subscribe: () => () => {} },
        beginCommand,
      } as unknown as SessionInput
      const dispose = bindInput(input, { ask: vi.fn() } as unknown as BtwController)
      await Promise.resolve(); dispose()
      if (draft === '/btw ') expect(beginCommand).toHaveBeenCalledTimes(1)
      else expect(beginCommand).not.toHaveBeenCalled()
    }
  })
  it('waits while the IME owns the text and caret', async () => {
    let callback = () => {}
    let composing = true
    const beginCommand = vi.fn()
    const input = {
      state: { getSnapshot: () => ({ phase: 'plain', draft: '/btw ', draftRev: 11, occurrences: [] }), subscribe: (fn: () => void) => { callback = fn; return () => {} } },
      editor: { isComposing: () => composing },
      beginCommand,
    } as unknown as SessionInput
    const dispose = bindInput(input, { ask: vi.fn() } as unknown as BtwController)
    await Promise.resolve()
    expect(beginCommand).not.toHaveBeenCalled()
    composing = false
    callback(); await Promise.resolve()
    expect(beginCommand).toHaveBeenCalledTimes(1)
    dispose()
  })
  it('opens a new side-thread view instead of reusing past questions', async () => {
    let callback = () => {}
    const state = { phase: 'plain', draft: '/btw ', draftRev: 3, occurrences: [] }
    let claim: CommandClaim | undefined
    const input = { state: { getSnapshot: () => state, subscribe: (fn: () => void) => { callback = fn; return () => {} } }, beginCommand: (value: CommandClaim) => { claim = value } } as unknown as SessionInput
    const ask = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
    const dispose = bindInput(input, { ask } as unknown as BtwController)
    await Promise.resolve()
    expect(claim?.token).toBe('/btw ')
    await claim!.submit('fresh question', {} as never, [])
    expect(ask).toHaveBeenCalledWith('fresh question', true)
    dispose()
  })
  it('does not claim another slash command or another source reference', async () => {
    for (const state of [
      { phase: 'plain', draft: '/btw-other q', draftRev: 1, occurrences: [] },
      { phase: 'plain', draft: '/btw q', draftRev: 1, occurrences: [{ offset: 0 }] },
    ]) {
      const beginCommand = vi.fn()
      const input = { state: { getSnapshot: () => state, subscribe: () => () => {} }, beginCommand } as unknown as SessionInput
      const dispose = bindInput(input, { ask: vi.fn() } as unknown as BtwController)
      await Promise.resolve(); dispose()
      expect(beginCommand).not.toHaveBeenCalled()
    }
  })
})
