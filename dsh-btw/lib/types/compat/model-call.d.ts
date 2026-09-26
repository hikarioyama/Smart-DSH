import { AssistantStreamAccumulator, createAssistantMessage, type LlmRuntime, type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { BtwCacheStrategy } from '../shared/protocol.js';
import type { BtwContextSnapshot } from './context.js';
export interface BtwOneShotResult {
    readonly archive: {
        message: ReturnType<typeof createAssistantMessage>;
        stream: ReturnType<AssistantStreamAccumulator["snapshot"]>;
    };
    readonly response: string;
    readonly usage?: TokenUsage;
    readonly cacheStrategy: BtwCacheStrategy;
    readonly finishKind: string;
}
export declare function runBtwOneShot(llm: LlmRuntime, snapshot: BtwContextSnapshot, sidechainId: string, signal: AbortSignal): Promise<BtwOneShotResult>;
