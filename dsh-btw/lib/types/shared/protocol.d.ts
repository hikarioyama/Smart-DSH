export declare const BTW_RPC_CHANNEL = "/api";
export declare const BTW_ASK_ENDPOINT = "dsh-btw/ask";
export interface BtwAskRequest {
    readonly requestId: string;
    readonly sessionId: string;
    readonly question: string;
}
export type BtwCacheStrategy = 'anthropic-shared-prefix' | 'provider-managed';
export interface BtwUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly reasoningTokens?: number;
}
export interface BtwAskResponse {
    readonly requestId: string;
    readonly sidechainId: string;
    readonly response: string;
    readonly cacheStrategy: BtwCacheStrategy;
    readonly usage?: BtwUsage;
}
export declare function readAskRequest(value: unknown): BtwAskRequest | undefined;
export declare function readAskResponse(value: unknown): BtwAskResponse | undefined;
export interface BtwTurn {
    id: string;
    question: string;
    at: number;
    anchorSeq: number | null;
    answer?: string;
    error?: string;
    durationMs?: number;
}
export declare function readSessionRequest(value: unknown): {
    sessionId: string;
} | undefined;
export declare function readTurn(value: unknown): BtwTurn | undefined;
export declare const BTW_FORK_ENDPOINT = "dsh-btw/fork";
