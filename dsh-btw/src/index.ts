import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import { Config, installBtwService, type BtwConfig } from './host/service.js'

export const name = 'btw'
export const inject = ['agents', 'connection', 'llm', 'sessionController', 'sessionProjections']
export { Config }
export type { BtwConfig }

export function apply(ctx: Context, config?: BtwConfig): void {
  installBtwService(ctx, config)
}
