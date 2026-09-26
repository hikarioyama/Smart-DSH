import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AuditStore } from '../src/core/audit-store.js'
import { installBtwService } from '../src/compat/host.js'
import { createBtwRpcRoute } from '../src/compat/transport.js'

async function setup() {
  const auditRoot = await mkdtemp(join(tmpdir(), 'smart-btw-cold-'))
  const store = new AuditStore(auditRoot)
  await store.append('parent', 'question', 'one', { question: 'saved question', anchorSeq: 3 })
  await store.append('parent', 'answer', 'one', { answer: 'saved answer' })
  const routes = new Map<string, ReturnType<typeof createBtwRpcRoute>>()
  const resolveAgent = vi.fn(async () => ({ error: { code: 'session/not-found', message: 'missing' } }))
  const ctx = {
    agents: { get: vi.fn(() => undefined) },
    sessionController: { inspect: vi.fn(async () => ({ events: [] })), resolveAgent },
    effect: (fn: () => void) => fn(),
    connection: { fetch: { register: (route: ReturnType<typeof createBtwRpcRoute>) => { routes.set(route.path, route) } } },
  } as unknown as Context
  installBtwService(ctx, { auditRoot })
  const call = async (endpoint: string, payload: Record<string, unknown>) => {
    const route = routes.get('/api/dsh-btw/' + endpoint)
    if (route === undefined) return undefined
    const response = await route.fetch(new Request('http://localhost' + route.path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'dsh-btw/' + endpoint, payload }),
    }))
    return (await response.json()).result
  }
  return { store, resolveAgent, call }
}

describe('host routes after removing the history API', () => {
  it('exposes only ask and fork, so no surface can restore past questions', async () => {
    const h = await setup()
    expect(await h.call('history', { sessionId: 'parent' })).toBeUndefined()
    expect(await h.call('fork', { sessionId: 'parent', turnId: 'one' })).toBeDefined()
  })
  it('reopens an already completed fork without activating its parent', async () => {
    const h = await setup()
    await h.store.append('parent', 'fork', 'one', { status: 'complete', childSessionId: 'child' })
    expect(await h.call('fork', { sessionId: 'parent', turnId: 'one' })).toEqual({ ok: true, value: { childSessionId: 'child' } })
    expect(h.resolveAgent).not.toHaveBeenCalled()
  })
  it('resolves a cold parent through the public API only for an explicit new ask', async () => {
    const h = await setup()
    const result = await h.call('ask', { sessionId: 'parent', question: 'new', requestId: 'new' })
    expect(h.resolveAgent).toHaveBeenCalledWith('parent')
    expect(result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    expect(await h.store.turns('parent')).toHaveLength(1)
  })
})
