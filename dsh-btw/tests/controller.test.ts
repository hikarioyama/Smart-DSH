import { describe, expect, it } from 'vitest'
import { BtwController, type Transport } from '../src/client/controller.js'
import type { BtwTurn } from '../src/shared/protocol.js'
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
function harness() {
  const turns: BtwTurn[] = []
  const endpoints: string[] = []
  let finish!: () => void
  let signal: AbortSignal | undefined
  const connection: Transport = { rpc: { call: async (_channel, endpoint, payload, inputSignal) => {
    endpoints.push(endpoint)
    signal = inputSignal
    const data = payload as { requestId: string; question: string }
    return new Promise((resolve, reject) => {
      finish = () => { const turn = { id: data.requestId, question: data.question, answer: 'answer', at: 1, anchorSeq: 10 }; turns.push(turn); resolve({ ok: true, value: { turn } }) }
      signal!.addEventListener('abort', () => reject(Error('cancelled')), { once: true })
    })
  } } }
  const controller = new BtwController(connection, 'parent', 1000)
  return { controller, endpoints, finish: () => finish(), signal: () => signal }
}
describe('BTW controller', () => {
  it('releases main input immediately and retains multiple exchanges', async () => {
    const h = harness()
    expect(await h.controller.ask('one')).toEqual({ kind: 'success' })
    expect(h.controller.state.getSnapshot()).toMatchObject({ busy: true, question: 'one' })
    h.finish(); await flush()
    await h.controller.ask('two'); h.finish(); await flush()
    expect(h.controller.state.getSnapshot().turns.map(t => t.question)).toEqual(['one', 'two'])
    h.controller.dispose()
  })
  it('starts a fresh view for a new /btw but appends panel follow-ups', async () => {
    const h = harness()
    await h.controller.ask('first', true); h.finish(); await flush()
    await h.controller.ask('follow-up'); h.finish(); await flush()
    expect(h.controller.state.getSnapshot().turns.map(t => t.question)).toEqual(['first', 'follow-up'])
    await h.controller.ask('new thread', true); h.finish(); await flush()
    expect(h.controller.state.getSnapshot().turns.map(t => t.question)).toEqual(['new thread'])
    h.controller.dispose()
  })
  it('never asks the host for stored history', async () => {
    const h = harness()
    await h.controller.ask('one', true); h.finish(); await flush()
    h.controller.open()
    h.controller.dismiss()
    expect(h.endpoints).toEqual(['dsh-btw/ask'])
    h.controller.dispose()
  })
  it('never opens a view for a bare /btw, because nothing is stored to show', async () => {
    const h = harness()
    expect(await h.controller.ask('   ')).toEqual({ kind: 'error', text: 'Type a question after /btw' })
    expect(h.controller.state.getSnapshot()).toMatchObject({ open: false, busy: false, turns: [] })
    expect(h.endpoints).toEqual([])
    h.controller.dispose()
  })
  it('closing panel never aborts work, explicit Cancel does', async () => {
    const h = harness()
    await h.controller.ask('one'); h.controller.dismiss()
    expect(h.signal()?.aborted).toBe(false)
    h.controller.cancel(); await flush()
    expect(h.signal()?.aborted).toBe(true)
    expect(h.controller.state.getSnapshot()).toMatchObject({ open: false, busy: false })
    h.controller.dispose()
  })
  it('refuses overlapping asks without cancelling first request', async () => {
    const h = harness()
    await h.controller.ask('one')
    expect((await h.controller.ask('two')).kind).toBe('error')
    expect(h.signal()?.aborted).toBe(false)
    h.finish(); await flush(); h.controller.dispose()
  })
  it('disposal cancels only its own request', async () => {
    const a = harness(), b = harness()
    await a.controller.ask('one'); await b.controller.ask('two')
    a.controller.dispose()
    expect(a.signal()?.aborted).toBe(true); expect(b.signal()?.aborted).toBe(false)
    b.finish(); await flush(); b.controller.dispose()
  })
})
