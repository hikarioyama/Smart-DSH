import { AuditStore, type Turn } from './audit-store.js';
export interface Answer {
    response: string;
    usage?: unknown;
    archive?: unknown;
    cacheStrategy: string;
}
export interface SideContext {
    anchorSeq: number | null;
    audit: Record<string, unknown>;
}
export interface ThreadDeps<C extends SideContext> {
    snapshot(sessionId: string, history: Turn[], question: string): C;
    generate(context: C, requestId: string, signal: AbortSignal): Promise<Answer>;
}
/** One active request per parent; independent parents remain concurrent. */
export declare class ThreadService<C extends SideContext> {
    readonly store: AuditStore;
    private readonly deps;
    private readonly busy;
    constructor(store: AuditStore, deps: ThreadDeps<C>);
    isBusy(sessionId: string): boolean;
    history(sessionId: string): Promise<Turn[]>;
    ask(sessionId: string, id: string, question: string, signal: AbortSignal): Promise<Turn>;
}
