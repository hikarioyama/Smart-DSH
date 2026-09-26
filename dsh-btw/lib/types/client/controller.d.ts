import { type BtwTurn } from '../shared/protocol.js';
export interface Transport {
    rpc: {
        call(channel: string, method: string, payload: unknown, signal: AbortSignal): Promise<{
            ok: true;
            value: unknown;
        } | {
            ok: false;
            error: {
                message: string;
            };
        }>;
    };
}
export interface PanelState {
    open: boolean;
    busy: boolean;
    turns: BtwTurn[];
    question: string;
    error: string | null;
}
/**
 * Pure state machine; no DSH, DOM or React dependency.
 *
 * The panel only shows the thread the user is working on now: nothing is restored
 * from the audit store, and a new `/btw` from the main composer starts a fresh
 * view while panel follow-ups append to it. Every exchange is still recorded in
 * the audit store, and fork reads that store through the host.
 */
export declare class BtwController {
    private readonly connection;
    readonly sessionId: string;
    private readonly timeoutMs;
    private value;
    private listeners;
    readonly state: {
        getSnapshot: () => PanelState;
        subscribe: (listener: () => void) => () => void;
    };
    private active;
    private disposed;
    constructor(connection: Transport, sessionId: string, timeoutMs?: number);
    private set;
    open(): void;
    ask(raw: string, fresh?: boolean): Promise<{
        kind: 'success';
    } | {
        kind: 'error';
        text: string;
    }>;
    private run;
    fork(turnId: string): Promise<string>;
    cancel(): void;
    dismiss(): void;
    dispose(): void;
}
