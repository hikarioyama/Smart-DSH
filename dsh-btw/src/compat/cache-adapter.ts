import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai'
import { shiftAnthropicCacheBoundary } from './cache-boundary.js'

interface MutableModels {
  streamSimple: (...args: unknown[]) => unknown
}

interface PiAiSnapshotInternals {
  readonly models: MutableModels
}

interface PiAiAdapterInternals {
  readonly config?: PiAiAdapterOptions
  current?: () => PiAiSnapshotInternals
}

interface RuntimeRegistrationInternals {
  readonly adapter?: unknown
}

interface RuntimeInternals {
  readonly adapters?: Map<string, RuntimeRegistrationInternals>
}

/**
 * Narrow, version-pinned derivative of DSH's public PiAiAdapter. Each call gets
 * its own delegate and Models collection, then adds pi-ai's public onPayload
 * hook without mutating the deployment's registered adapter.
 */
export class BtwPiAiAdapter extends PiAiAdapter {
  constructor(
    private readonly btwOptions: PiAiAdapterOptions,
    private readonly onBoundaryMoved: () => void,
  ) {
    super(btwOptions)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Freeze the selected profiles for this call before credential resolution.
    const profiles = this.btwOptions.profiles()
    const delegate = new PiAiAdapter({ ...this.btwOptions, profiles: () => profiles })
    const internal = delegate as unknown as PiAiAdapterInternals
    if (typeof internal.current !== 'function') {
      throw new Error('dsh-btw: incompatible PiAiAdapter internals (expected 0.1.5-rc.2 current())')
    }
    const snapshot = internal.current.call(delegate)
    const models = snapshot.models
    if (typeof models?.streamSimple !== 'function') {
      throw new Error('dsh-btw: incompatible PiAiAdapter internals (expected Models.streamSimple())')
    }
    const original = models.streamSimple.bind(models)
    models.streamSimple = (...args: unknown[]): unknown => {
      const rawOptions = typeof args[2] === 'object' && args[2] !== null
        ? args[2] as Record<string, unknown>
        : {}
      const upstream = typeof rawOptions.onPayload === 'function'
        ? rawOptions.onPayload as (payload: unknown, model: unknown) => unknown | Promise<unknown>
        : undefined
      args[2] = {
        ...rawOptions,
        onPayload: async (payload: unknown, model: unknown): Promise<unknown> => {
          const upstreamValue = upstream === undefined ? undefined : await upstream(payload, model)
          const effective = upstreamValue === undefined ? payload : upstreamValue
          const api = typeof model === 'object' && model !== null
            ? (model as Record<string, unknown>).api
            : undefined
          if (api !== 'anthropic-messages') return effective
          const shifted = shiftAnthropicCacheBoundary(effective)
          if (shifted.moved) this.onBoundaryMoved()
          return shifted.payload
        },
      }
      return original(...args)
    }
    yield* delegate.stream(options)
  }
}

/**
 * Read only the constructor hooks of the registered 0.1.5-rc.2 pi-ai
 * adapter. No registry entry or live adapter is changed. Other adapters use
 * the public LlmRuntime fallback.
 */
export function btwPiAiAdapter(
  runtime: LlmRuntime,
  provider: string,
  onBoundaryMoved: () => void,
): BtwPiAiAdapter | undefined {
  const registry = (runtime as unknown as RuntimeInternals).adapters
  const candidate = registry?.get(provider)?.adapter
  if (candidate === undefined) return undefined
  const internal = candidate as PiAiAdapterInternals
  const isPiAi = candidate instanceof PiAiAdapter
    || (candidate as { constructor?: { name?: string } }).constructor?.name === 'PiAiAdapter'
  if (!isPiAi) return undefined
  if (internal.config === undefined
    || typeof internal.config.profiles !== 'function'
    || typeof internal.config.resolveApiKey !== 'function'
    || internal.config.auth?.credentials === undefined
    || internal.config.auth.authContext === undefined) {
    throw new Error('dsh-btw: incompatible PiAiAdapter constructor hooks (expected 0.1.5-rc.2 auth injection)')
  }
  return new BtwPiAiAdapter(internal.config, onBoundaryMoved)
}
