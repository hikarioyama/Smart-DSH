import { describe, expect, it, vi } from 'vitest'
import { PiAiAdapter, type PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { BtwPiAiAdapter, btwPiAiAdapter } from '../src/host/btw-pi-ai-adapter.js'

function options(): PiAiAdapterOptions {
  return {
    profiles: () => new Map(),
    resolveApiKey: async () => undefined,
    auth: {
      credentials: {
        read: async () => undefined, list: async () => [],
        modify: async () => undefined, delete: async () => {},
      },
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  }
}

describe('0.1.5 PiAiAdapter bridge', () => {
  it('constructs the real isolated SDK collection with the new auth injection', async () => {
    const config = options()
    const profiles = vi.fn(config.profiles)
    const adapter = new BtwPiAiAdapter({ ...config, profiles }, () => {})
    // Reaches the real upstream model resolver, not an obsolete internals error.
    await expect(async () => {
      for await (const _chunk of adapter.stream({ provider: 'missing', model: 'none', messages: [] })) {}
    }).rejects.toThrow('does not own provider')
    expect(profiles).toHaveBeenCalledTimes(1)
  })

  it('does not replace or mutate the registered upstream adapter', () => {
    const original = new PiAiAdapter(options())
    const registry = new Map([['pi', { adapter: original }]])
    const runtime = { adapters: registry } as unknown as LlmRuntime
    expect(btwPiAiAdapter(runtime, 'pi', () => {})).toBeInstanceOf(BtwPiAiAdapter)
    expect(registry.get('pi')?.adapter).toBe(original)
    expect(btwPiAiAdapter(runtime, 'other', () => {})).toBeUndefined()
  })

  it('fails closed for a recognized adapter without the new credential hooks', () => {
    const old = new PiAiAdapter({ profiles: () => new Map(), resolveApiKey: async () => undefined } as PiAiAdapterOptions)
    const runtime = { adapters: new Map([['pi', { adapter: old }]]) } as unknown as LlmRuntime
    expect(() => btwPiAiAdapter(runtime, 'pi', () => {})).toThrow('auth injection')
  })

  it('preserves upstream payload hooks while moving the Anthropic tail marker', async () => {
    const payload = { messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'shared' }] },
      { role: 'user', content: [{ type: 'text', text: 'tail', cache_control: { type: 'ephemeral' } }] },
    ] }
    const upstream = vi.fn(() => payload)
    const moved = vi.fn()
    let effective: unknown
    const models = { streamSimple: vi.fn(async (...args: unknown[]) => {
      const hook = (args[2] as { onPayload: (p: unknown, m: unknown) => Promise<unknown> }).onPayload
      effective = await hook({}, args[0])
    }) }
    const prototype = PiAiAdapter.prototype as unknown as { current(): { models: typeof models } }
    const current = vi.spyOn(prototype, 'current').mockReturnValue({ models })
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream').mockImplementation(async function* (this: PiAiAdapter, _options: GenerateOptions) {
      const instance = this as unknown as typeof prototype
      await instance.current().models.streamSimple({ api: 'anthropic-messages' }, {}, { onPayload: upstream })
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    try {
      for await (const _chunk of new BtwPiAiAdapter(options(), moved).stream({ provider: 'mock', model: 'mock', messages: [] })) {}
      expect(upstream).toHaveBeenCalledOnce()
      expect(moved).toHaveBeenCalledOnce()
      expect(effective).toMatchObject({ messages: [
        { content: [{ cache_control: { type: 'ephemeral' } }] },
        { content: [{ type: 'text', text: 'tail' }] },
      ] })
      expect((effective as typeof payload).messages[1]?.content[0]).not.toHaveProperty('cache_control')
      expect(payload.messages[1]?.content[0]).toHaveProperty('cache_control')
    } finally { stream.mockRestore(); current.mockRestore() }
  })
})
