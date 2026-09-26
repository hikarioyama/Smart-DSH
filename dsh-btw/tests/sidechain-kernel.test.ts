import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { PrivateSidechainKernel } from '../src/host/sidechain-kernel.js'
import type { BtwContextSnapshot } from '../src/host/context-snapshot.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('PrivateSidechainKernel', () => {
  it('persists only beneath its private root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-btw-test-'))
    roots.push(root)
    const kernel = new PrivateSidechainKernel({ mode: 'private-jsonl', root, retentionDays: 1, maxSessions: 5 })
    const request: BtwContextSnapshot = {
      parentSessionId: 'main-session',
      config: { provider: 'mock', model: 'mock' },
      sharedMessages: [],
      messages: [],
    }
    const id = kernel.createId()
    expect(await kernel.begin('side question', request, id)).toBe(id)
    await kernel.finish(id, {
      kind: 'success',
      result: { response: 'answer', cacheStrategy: 'provider-managed', finishKind: 'stop' },
    })
    const rows = (await readFile(join(root, `${id}.jsonl`), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ type: 'start', parentSessionId: 'main-session', question: 'side question' })
    expect(rows[1]).toMatchObject({ type: 'end', outcome: { kind: 'success', result: { response: 'answer' } } })
  })
})
