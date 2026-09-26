type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function takeTailCacheControl(message: JsonObject): unknown {
  if (!Array.isArray(message.content)) return undefined
  let found: unknown
  for (const value of message.content) {
    const block = object(value)
    if (block === undefined || block.cache_control === undefined) continue
    found ??= block.cache_control
    delete block.cache_control
  }
  return found
}

function markMessage(message: JsonObject, cacheControl: unknown): boolean {
  if (typeof message.content === 'string' && message.content.length > 0) {
    message.content = [{ type: 'text', text: message.content, cache_control: cacheControl }]
    return true
  }
  if (!Array.isArray(message.content)) return false
  for (let index = message.content.length - 1; index >= 0; index--) {
    const block = object(message.content[index])
    if (block === undefined) continue
    const type = block.type
    if (type === 'text' || type === 'image' || type === 'tool_result' || type === 'tool_use'
      || type === 'thinking' || type === 'redacted_thinking') {
      block.cache_control = cacheControl
      return true
    }
  }
  return false
}

export interface CacheBoundaryResult {
  readonly payload: unknown
  readonly moved: boolean
}

/**
 * pi-ai marks the final user block. A fire-and-forget BTW tail has no future
 * consumer, so move that marker to the last cacheable block in the shared
 * prefix. The input object is never mutated.
 */
export function shiftAnthropicCacheBoundary(payload: unknown): CacheBoundaryResult {
  const root = object(payload)
  if (root === undefined || !Array.isArray(root.messages) || root.messages.length < 2) {
    return { payload, moved: false }
  }
  const cloned = structuredClone(root)
  const messages = cloned.messages as unknown[]
  const tail = object(messages.at(-1))
  if (tail === undefined) return { payload, moved: false }
  const cacheControl = takeTailCacheControl(tail)
  if (cacheControl === undefined) return { payload, moved: false }
  for (let index = messages.length - 2; index >= 0; index--) {
    const candidate = object(messages[index])
    if (candidate !== undefined && markMessage(candidate, cacheControl)) {
      return { payload: cloned, moved: true }
    }
  }
  return { payload, moved: false }
}
