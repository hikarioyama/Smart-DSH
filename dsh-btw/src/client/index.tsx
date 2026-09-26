import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { dockStyle } from './compat/layout.js'
import { bindInput } from './compat/input.js'
import { BtwController } from './controller.js'
import { createBtwInputSource } from './input-source.js'
import { BtwOverlay, type BtwOverlayInjected } from './overlay.js'

export const name = 'btw-client'
export const inject = ['connection', 'inputTriggers', 'sessions', 'slots', 'conversation']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  const sessions = ctx.get('sessions') as ISessions | undefined
  if (connection === undefined || inputTriggers === undefined || sessions === undefined) {
    throw new Error('dsh-btw/client requires connection, inputTriggers, and sessions')
  }

  const conversation = ctx.conversation
  const controllers = new Map<SessionId, BtwController>()
  const boundScopes = new Set<SessionId>()
  const controllerFor = (sessionId: SessionId): BtwController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new BtwController(connection, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.effect(() => inputTriggers.registerSource(createBtwInputSource(controllerFor)), 'dsh-btw: slash source')
  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
    boundScopes.clear()
  }, 'dsh-btw: controller teardown')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'btw-panel',
    order: 2,
    inject: (scopeId): BtwOverlayInjected => {
      const sessionId = SessionId(scopeId)
      const actx = sessions.scope(sessionId)
      if (actx === undefined) throw new Error(`dsh-btw: session "${String(sessionId)}" resolved no client scope`)
      const controller = controllerFor(sessionId)
      if (!boundScopes.has(sessionId)) {
        boundScopes.add(sessionId)
        actx.effect(() => bindInput(conversation.input.for(actx), controller))
        actx.effect(() => () => {
          boundScopes.delete(sessionId)
          if (controllers.get(sessionId) === controller) controllers.delete(sessionId)
          controller.dispose()
        }, 'dsh-btw: session controller')
      }
      return { controller, dockStyle,
        openChild: async id => { await sessions.refresh(); sessions.open(SessionId(id)) },
      }
    },
  }, BtwOverlay))
}
