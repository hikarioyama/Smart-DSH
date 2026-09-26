export interface Turn {
    id: string;
    question: string;
    at: number;
    anchorSeq: number | null;
    answer?: string;
    error?: string;
    durationMs?: number;
}
export interface RecordV1 {
    version: 1;
    sessionId: string;
    type: 'question' | 'answer' | 'error' | 'fork';
    id: string;
    at: number;
    data: Record<string, unknown>;
}
/** Versioned audit data, independent of DSH storage. Never prunes records. */
export declare class AuditStore {
    readonly root: string;
    constructor(root: string);
    private filename;
    records(sessionId: string): Promise<RecordV1[]>;
    /** Keep large request snapshots outside the small thread index. Content-addressed, immutable. */
    snapshot(data: Record<string, unknown>): Promise<{
        sha256: string;
    }>;
    turns(sessionId: string): Promise<Turn[]>;
    /** Caller serializes a session across the entire request, not just each append. */
    append(sessionId: string, type: RecordV1['type'], id: string, data: Record<string, unknown>): Promise<void>;
}
