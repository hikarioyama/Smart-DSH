import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
export interface BtwConfig {
    timeoutMs?: number;
    auditRoot?: string;
}
export declare const Config: schema<Schemastery.ObjectS<{
    timeoutMs: schema<number, number>;
    auditRoot: schema<string, string>;
}>, Schemastery.ObjectT<{
    timeoutMs: schema<number, number>;
    auditRoot: schema<string, string>;
}>>;
export declare function installBtwService(ctx: Context, config?: BtwConfig): void;
