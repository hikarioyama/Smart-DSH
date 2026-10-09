import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
export interface BtwConfig {
    timeoutMs?: number;
    auditRoot?: string;
}
export declare const Config: schema<Schemastery.ObjectS<NoInfer<{
    timeoutMs: schema<number, number, "defined">;
    auditRoot: schema<string, string, "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    timeoutMs: schema<number, number, "defined">;
    auditRoot: schema<string, string, "plain">;
}>>, "plain">;
export declare function installBtwService(ctx: Context, config?: BtwConfig): void;
