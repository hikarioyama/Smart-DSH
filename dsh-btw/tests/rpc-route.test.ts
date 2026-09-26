import { describe, expect, it, vi } from 'vitest'
import { createBtwRpcRoute } from '../src/host/rpc-route.js'
import { BTW_ASK_ENDPOINT } from '../src/shared/protocol.js'

describe('official shared-carrier RPC contract', () => {
  it('registers only an additive plugin-owned path and returns a correlated envelope', async () => {
    const handler = vi.fn(async () => ({ ok: true as const, value: 'answer' }))
    const route = createBtwRpcRoute(handler)
    expect(route).toMatchObject({ path: '/api/dsh-btw/ask', methods: ['POST'], requestBody: 'buffered' })
    const request = new Request('http://localhost' + route.path, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-request', rpcId: 'correlation', method: BTW_ASK_ENDPOINT, payload: { question: 'hello' },
      }) })
    const response = await route.fetch(request)
    expect(await response.json()).toEqual({ type: 'server-response', rpcId: 'correlation', result: { ok: true, value: 'answer' } })
    expect(handler).toHaveBeenCalledWith(BTW_ASK_ENDPOINT, { question: 'hello' }, request.signal)
  })

  it('rejects malformed envelopes and mismatched methods without dispatch', async () => {
    const handler = vi.fn(async () => ({ ok: true as const, value: null }))
    const route = createBtwRpcRoute(handler)
    const request = (body: string) => new Request('http://localhost' + route.path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    expect((await route.fetch(request('{'))).status).toBe(400)
    expect((await route.fetch(request('{}'))).status).toBe(400)
    const wrong = await route.fetch(request(JSON.stringify({ type: 'client-request', rpcId: 'id', method: 'official/route', payload: {} })))
    expect((await wrong.json()).result.ok).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })
})
