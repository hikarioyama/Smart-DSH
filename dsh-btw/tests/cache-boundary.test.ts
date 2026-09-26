import { describe, expect, it } from 'vitest'
import { shiftAnthropicCacheBoundary } from '../src/host/cache-boundary.js'

describe('shiftAnthropicCacheBoundary', () => {
  it('moves the tail marker to the final shared-prefix block without mutating input', () => {
    const payload = {
      model: 'claude',
      messages: [
        { role: 'user', content: 'shared question' },
        { role: 'assistant', content: [{ type: 'text', text: 'shared answer' }] },
        {
          role: 'user',
          content: [{ type: 'text', text: 'btw tail', cache_control: { type: 'ephemeral', ttl: '5m' } }],
        },
      ],
    }
    const result = shiftAnthropicCacheBoundary(payload)
    expect(result.moved).toBe(true)
    expect(payload.messages[2]?.content[0]).toHaveProperty('cache_control')
    const moved = result.payload as typeof payload
    expect(moved.messages[2]?.content[0]).not.toHaveProperty('cache_control')
    expect(moved.messages[1]?.content[0]).toMatchObject({
      cache_control: { type: 'ephemeral', ttl: '5m' },
    })
  })

  it('does nothing when pi-ai caching is disabled', () => {
    const payload = {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'shared' }] },
        { role: 'user', content: [{ type: 'text', text: 'tail' }] },
      ],
    }
    const result = shiftAnthropicCacheBoundary(payload)
    expect(result).toEqual({ payload, moved: false })
  })
})
