import type { BtwContextSnapshot } from './context-snapshot.js';
import type { BtwOneShotResult } from './one-shot.js';
export type SidechainMode = 'private-jsonl' | 'memory' | 'none';
export interface SidechainConfig {
    readonly mode?: SidechainMode;
    readonly root?: string;
    readonly retentionDays?: number;
    readonly maxSessions?: number;
}
interface SidechainEnd {
    readonly version: 1;
    readonly type: 'end';
    readonly sidechainId: string;
    readonly completedAt: string;
    readonly outcome: {
        readonly kind: 'success';
        readonly result: BtwOneShotResult;
    } | {
        readonly kind: 'error';
        readonly message: string;
    };
}
export declare class PrivateSidechainKernel {
    readonly mode: SidechainMode;
    readonly root: string;
    private readonly retentionMs;
    private readonly maxSessions;
    private readonly memory;
    constructor(config?: SidechainConfig);
    createId(): string;
    begin(question: string, request: BtwContextSnapshot, sidechainId?: string): Promise<string>;
    finish(sidechainId: string, outcome: SidechainEnd['outcome']): Promise<void>;
    private filename;
    private pruneMemory;
    private pruneFiles;
}
export {};
