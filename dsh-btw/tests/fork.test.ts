import { describe, it, expect } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage, AssistantStreamAccumulator, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { appendSideTurns } from '../src/compat/fork.js'

describe('fork archive through real Session validator', () => {
  it('retains main prefix and exact BTW answers without modifying the parent or generating again', () => {
    const parent = Session.create(SessionId('parent'))
    parent.append('turn/start', { turn: 1 })
    parent.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'main' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const before = parent.snapshotEvents()
    const child = Session.create(SessionId('child'), before)
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'side answer' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'side answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const stream = new AssistantStreamAccumulator()
    for (const chunk of chunks) stream.push({ time: 10, chunk })
    appendSideTurns(child, [{ turn: { id: 'one', question: 'side question', answer: 'side answer', at: 10, anchorSeq: 3 },
      message: createAssistantMessage({ content: [{ type: 'text', text: 'side answer' }], source: { provider: 'mock', model: 'mock' } }),
      stream: [...stream.snapshot()],
    }])
    expect(parent.snapshotEvents()).toEqual(before)
    expect(child.deriveMessages().map(m => m.content)).toEqual([
      [{ type: 'text', text: 'main' }], [{ type: 'text', text: 'side question' }], [{ type: 'text', text: 'side answer' }],
    ])
    const restored = Session.create(SessionId('restored'), child.snapshotEvents())
    expect(restored.deriveMessages()).toEqual(child.deriveMessages())
    expect(child.snapshotEvents().map(e => e.seq)).toEqual(child.snapshotEvents().map((_, i) => i))
  })
})

it('refuses ambiguous prior fork creation and reuses a completed child', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { AuditStore } = await import('../src/core/audit-store.js')
  const { forkThread } = await import('../src/compat/fork.js')
  const store = new AuditStore(await mkdtemp(join(tmpdir(), 'btw-fork-retry-')))
  await store.append('parent', 'fork', 'one', { status: 'requested', anchorSeq: 3 })
  await expect(forkThread({} as never, store, 'parent', 'one')).rejects.toThrow('refusing duplicate creation')
  await store.append('parent', 'fork', 'one', { status: 'complete', childSessionId: 'existing-child' })
  expect(await forkThread({} as never, store, 'parent', 'one')).toBe('existing-child')
})
