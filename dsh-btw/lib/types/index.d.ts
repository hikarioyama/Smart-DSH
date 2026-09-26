import type { Context } from '@deepseek-ai/cordis';
import { Config, type BtwConfig } from './host/service.js';
export declare const name = "btw";
export declare const inject: string[];
export { Config };
export type { BtwConfig };
export declare function apply(ctx: Context, config?: BtwConfig): void;
