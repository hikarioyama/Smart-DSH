import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter, type PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai';
/**
 * Narrow, version-pinned derivative of DSH's public PiAiAdapter. Each call gets
 * its own delegate and Models collection, then adds pi-ai's public onPayload
 * hook without mutating the deployment's registered adapter.
 */
export declare class BtwPiAiAdapter extends PiAiAdapter {
    private readonly btwOptions;
    private readonly onBoundaryMoved;
    constructor(btwOptions: PiAiAdapterOptions, onBoundaryMoved: () => void);
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * Read only the constructor hooks of the registered 0.1.5-rc.2 pi-ai
 * adapter. No registry entry or live adapter is changed. Other adapters use
 * the public LlmRuntime fallback.
 */
export declare function btwPiAiAdapter(runtime: LlmRuntime, provider: string, onBoundaryMoved: () => void): BtwPiAiAdapter | undefined;
