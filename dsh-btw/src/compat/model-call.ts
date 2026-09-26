import { AssistantStreamAccumulator, createAssistantMessage, BlockAssembler, type ContentBlock, type LlmRuntime, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { BtwCacheStrategy } from '../shared/protocol.js'
import type { BtwContextSnapshot } from './context.js'
import { SessionId } from '@deepseek-ai/dsh-session/types'

export interface BtwOneShotResult {
  readonly archive: { message: ReturnType<typeof createAssistantMessage>; stream: ReturnType<AssistantStreamAccumulator["snapshot"]> }
  readonly response: string
  readonly usage?: TokenUsage
  readonly cacheStrategy: BtwCacheStrategy
  readonly finishKind: string
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .filter(text => text.trim().length > 0)
    .join('\n\n')
    .trim()
}

function toolOnlyFallback(blocks: readonly ContentBlock[]): string | undefined {
  const call = blocks.find((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
  if (call === undefined) return undefined
  const name = call.name.trim() === '' ? 'a tool' : call.name
  return `(The model tried to call ${name} instead of answering directly. Try rephrasing or ask in the main conversation.)`
}

export async function runBtwOneShot(
  llm: LlmRuntime,
  snapshot: BtwContextSnapshot,
  sidechainId: string,
  signal: AbortSignal,
): Promise<BtwOneShotResult> {
  const requestBase = {
    messages: snapshot.messages,
    ...(snapshot.system === undefined ? {} : { system: snapshot.system }),
    ...(snapshot.tools === undefined ? {} : { tools: snapshot.tools }),
    sessionId: SessionId(sidechainId),
    signal,
  }

  // Public runtime only. No inspection of pi-ai adapter internals or retrying paid calls.
  const prepared = await llm.prepareCall(snapshot.config, signal)
  const stream = prepared.stream({ ...prepared.config, ...requestBase })

  const assembler = new BlockAssembler()
  const archive = new AssistantStreamAccumulator()
  for await (const chunk of stream) assembler.push(archive.push({ time: Date.now(), chunk }).chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const message = finish.failure.message || `LLM request ${finish.kind}`
    throw new Error(message)
  }
  const blocks = assembler.blocks()
  const response = textOf(blocks) || toolOnlyFallback(blocks)
  if (response === undefined) throw new Error('No response received')
  return {
    response,
    archive: { message: createAssistantMessage({ content: blocks, source: { provider: snapshot.config.provider, model: snapshot.config.model } }), stream: archive.snapshot() },
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    cacheStrategy: 'provider-managed',
    finishKind: finish.kind,
  }
}
