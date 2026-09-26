import type { Context } from '@deepseek-ai/cordis';
import { type AssistantMessage, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm';
import { Session } from '@deepseek-ai/dsh-session';
import type { AuditStore, Turn } from '../core/audit-store.js';
export interface ArchivedTurn {
    turn: Turn;
    message: AssistantMessage;
    stream: AssistantStreamRecord[];
}
/** Uses real provider output, never fabricates an assistant stream. */
export declare function appendSideTurns(session: Session, turns: readonly ArchivedTurn[]): void;
export declare function forkThread(ctx: Context, store: AuditStore, parentId: string, turnId: string): Promise<string>;
