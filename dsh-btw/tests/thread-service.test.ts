import { mkdtemp, readFile, readdir, stat, appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { AuditStore } from '../src/core/audit-store.js'
import { ThreadService } from '../src/core/thread-service.js'

async function setup(generate = async () => ({ response: 'answer', cacheStrategy: 'provider-managed' })) {
  const root = await mkdtemp(join(tmpdir(), 'smart-btw-test-'))
  const snapshots: unknown[] = []
  const store = new AuditStore(root)
  const service = new ThreadService(store, {
    snapshot(sessionId, history, question) { snapshots.push(structuredClone(history)); return { anchorSeq: 10, audit: { sessionId, question } } },
    generate,
  })
  return { root, store, service, snapshots }
}
const signal = () => new AbortController().signal

describe('durable multi-turn side thread', () => {
  it('retains follow-ups across restart, isolates parents and writes private audit files', async () => {
    const { root, service, snapshots } = await setup()
    await service.ask('parent', 'one', 'first', signal())
    await service.ask('parent', 'two', 'second', signal())
    expect(snapshots[1]).toMatchObject([{ question: 'first', answer: 'answer' }])
    expect(await new AuditStore(root).turns('parent')).toHaveLength(2)
    expect(await service.history('other')).toEqual([])
    const file = join(root, (await readdir(root)).find(f => f.endsWith('.jsonl'))!)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await readFile(file, 'utf8')).trim().split('\n').map(x => JSON.parse(x).type)).toEqual(['question', 'answer', 'question', 'answer'])
  })
  it('does not duplicate completed requests or silently reuse their identity', async () => {
    let calls = 0
    const { service } = await setup(async () => { calls++; return { response: 'ok', cacheStrategy: 'provider-managed' } })
    await service.ask('parent', 'one', 'first', signal())
    await service.ask('parent', 'one', 'first', signal())
    expect(calls).toBe(1)
    await expect(service.ask('parent', 'one', 'changed', signal())).rejects.toThrow('identity')
  })
  it('refuses same-parent overlap but permits independent sessions', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { service } = await setup(async () => { await gate; return { response: 'ok', cacheStrategy: 'provider-managed' } })
    const first = service.ask('a', 'one', 'q', signal())
    await expect(service.ask('a', 'two', 'q', signal())).rejects.toThrow('already running')
    const other = service.ask('b', 'one', 'q', signal())
    release()
    await Promise.all([first, other])
  })
  it('records failures and permits a new request after failure', async () => {
    let fail = true
    const { service } = await setup(async () => { if (fail) throw Error('failed'); return { response: 'ok', cacheStrategy: 'provider-managed' } })
    await expect(service.ask('a', 'one', 'q', signal())).rejects.toThrow('failed')
    expect((await service.history('a'))[0]?.error).toBe('generation-or-audit-failed')
    fail = false
    await service.ask('a', 'two', 'retry', signal())
  })
  it('fails closed on an interrupted JSONL tail instead of overwriting audit', async () => {
    const { root, service } = await setup()
    await service.ask('a', 'one', 'q', signal())
    const file = join(root, (await readdir(root)).find(f => f.endsWith('.jsonl'))!)
    await appendFile(file, '{"version":')
    const before = await readFile(file)
    await expect(service.ask('a', 'two', 'q', signal())).rejects.toThrow('Incomplete audit tail')
    expect(await readFile(file)).toEqual(before)
  })
  it('retains 100 follow-ups and full context across a service restart without duplicate generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smart-btw-many-turns-'))
    const questions = Array.from({ length: 100 }, (_, i) => `question-${i}`)
    let calls = 0
    const deps = {
      snapshot(sessionId: string, history: import('../src/core/audit-store.js').Turn[], question: string) {
        const index = questions.indexOf(question)
        expect(history.map(t => t.question)).toEqual(questions.slice(0, index))
        expect(history.every(t => t.answer === `answer:${t.question}`)).toBe(true)
        return { anchorSeq: 10, audit: { sessionId, question, history }, question }
      },
      async generate(context: { question: string }) { calls++; return { response: `answer:${context.question}`, cacheStrategy: 'provider-managed' } },
    }
    let service = new ThreadService(new AuditStore(root), deps)
    for (const [i, question] of questions.entries()) {
      if (i === 50) service = new ThreadService(new AuditStore(root), deps)
      await service.ask('parent', `id-${i}`, question, signal())
    }
    service = new ThreadService(new AuditStore(root), deps)
    expect((await service.history('parent')).map(t => t.question)).toEqual(questions)
    expect((await service.ask('parent', 'id-0', questions[0]!, signal())).answer).toBe('answer:question-0')
    expect(calls).toBe(100)
    expect(await service.history('unrelated')).toEqual([])
  }, 15000)
  it('records real cancellation without a success and allows a later request', async () => {
    const abort = new AbortController()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const root = await mkdtemp(join(tmpdir(), 'smart-btw-abort-'))
    const store = new AuditStore(root)
    const service = new ThreadService(store, {
      snapshot: () => ({ anchorSeq: 10, audit: {} }),
      async generate(_context, id, inputSignal) {
        if (id === 'cancel') {
          entered()
          await new Promise<void>(resolve => inputSignal.addEventListener('abort', () => resolve(), { once: true }))
          // Even an adapter that returns after abort must not record a success.
        }
        return { response: 'answer', cacheStrategy: 'provider-managed' }
      },
    })
    const request = service.ask('parent', 'cancel', 'question', abort.signal)
    const rejected = expect(request).rejects.toThrow()
    await started; abort.abort(); await rejected
    expect((await service.history('parent'))[0]).toMatchObject({ error: 'cancelled-or-timeout' })
    expect((await store.records('parent')).some(r => r.type === 'answer')).toBe(false)
    await service.ask('parent', 'next', 'retry', signal())
    expect((await service.history('parent'))[1]?.answer).toBe('answer')
  })
  it('refuses replay of an interrupted request but retains it when a new request succeeds', async () => {
    const { service, store } = await setup()
    await store.append('parent', 'question', 'interrupted', { question: 'old', anchorSeq: 10 })
    await expect(service.ask('parent', 'interrupted', 'old', signal())).rejects.toThrow('interrupted')
    await service.ask('parent', 'new', 'new question', signal())
    const history = await service.history('parent')
    expect(history).toHaveLength(2)
    expect(history[0]?.answer).toBeUndefined()
    expect(history[1]?.answer).toBe('answer')
  })
  it('deduplicates immutable private context files and refuses damaged snapshots', async () => {
    const { root, store } = await setup()
    const data = { parent: 'synthetic', events: [{ text: 'private synthetic context' }] }
    const first = await store.snapshot(data)
    expect(await store.snapshot(data)).toEqual(first)
    const dir = join(root, 'contexts')
    const file = join(dir, first.sha256 + '.json')
    expect(await readdir(dir)).toEqual([first.sha256 + '.json'])
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await writeFile(file, 'synthetic corruption')
    await expect(store.snapshot(data)).rejects.toThrow('Damaged audit context')
    expect(await readFile(file, 'utf8')).toBe('synthetic corruption')
  })
  it('writes only inside its root even for path-like session IDs', async () => {
    const { root, service } = await setup()
    await service.ask('../../outside', 'one', 'q', signal())
    expect((await readdir(root)).filter(f => f.endsWith('.jsonl'))).toHaveLength(1)
    expect((await readdir(root)).find(f => f.endsWith('.jsonl'))).toMatch(/^[a-f0-9]{64}\.jsonl$/)
  })
})
