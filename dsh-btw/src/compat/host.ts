import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import { forkThread } from '../compat/fork.js'
import type {} from '@deepseek-ai/dsh-client-connection'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import schema from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { BTW_ASK_ENDPOINT, BTW_FORK_ENDPOINT, readAskRequest, readSessionRequest } from '../shared/protocol.js'
import { BTW_REMINDER, snapshotContext } from '../compat/context.js'
import { runBtwOneShot } from '../compat/model-call.js'
import { createBtwRpcRoute } from '../compat/transport.js'
import { ThreadService } from '../core/thread-service.js'
import { AuditStore } from '../core/audit-store.js'

export interface BtwConfig { timeoutMs?: number; auditRoot?: string }
export const Config = schema.object({ timeoutMs: schema.natural().min(1).default(120000), auditRoot: schema.string() })

export function installBtwService(ctx: Context, config: BtwConfig = {}): void {
  const store = new AuditStore(config.auditRoot ?? join(resolveDshHome(), 'btw-threads', 'v1'))
  const forking = new Set<string>()
  const service = new ThreadService(store, {
    snapshot(sessionId, history, question) {
      const agent = ctx.agents.get(SessionId(sessionId))
      if (!agent) throw Error('No live parent session. Open the main conversation first.')
      const selection = ctx.sessionProjections.stateOf(agent.session, 'modelSelection')
      if (!selection) throw Error('Model selection projection unavailable; refusing a possibly stale model route')
      const pending = selection.pending
      const snapshot = snapshotContext(agent, question, history, pending === null ? undefined : {
        provider: pending.provider, model: pending.model,
        ...(pending.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(pending.reasoningEffort) }),
      })
      const anchorSeq = agent.session.snapshotEvents().findLast(e => e.type === 'turn/end')?.seq ?? null
      return { agent, snapshot, anchorSeq, audit: {
        // Credentials are resolved later by the provider, never written here.
        provider: snapshot.config.provider, model: snapshot.config.model,
        parentMessages: snapshot.sharedMessages, sideInstruction: BTW_REMINDER,
        ...(snapshot.config.reasoningEffort === undefined ? {} : { reasoningEffort: snapshot.config.reasoningEffort }), ...(snapshot.tools ? { tools: snapshot.tools } : {}),
      } }
    },
    generate(context, id, signal) {
      return ctx.agents.withInitiator(context.agent, () => runBtwOneShot(ctx.llm, context.snapshot, id, signal))
    },
  })
  for (const endpoint of [BTW_ASK_ENDPOINT, BTW_FORK_ENDPOINT]) {
    ctx.effect(() => ctx.connection.fetch.register(createBtwRpcRoute(async (method, payload, signal) => {
      try {
        const session = readSessionRequest(payload)
        if (!session) return { ok: false, error: { code: 'bad-request', message: 'Invalid session request', details: { issues: [] } } }
        if (forking.has(session.sessionId)) throw Error('A fork is in progress')
        if (method === BTW_FORK_ENDPOINT) {
          if (service.isBusy(session.sessionId)) throw Error('Wait for the current BTW request')
          const turnId = (payload as Record<string, unknown>).turnId
          if (typeof turnId !== 'string') throw Error('Invalid turn identity')
          forking.add(session.sessionId)
          try { return { ok: true, value: { childSessionId: await forkThread(ctx, store, session.sessionId, turnId) } } }
          finally { forking.delete(session.sessionId) }
        }
        const request = readAskRequest(payload)
        if (!request) throw Error('Invalid /btw request')
        const combined = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 120000)])
        combined.throwIfAborted()
        // Only an explicit new question needs the Agent-owned model context.
        // The public resolver deduplicates concurrent loads of persisted sessions.
        const resolved = await ctx.sessionController.resolveAgent(SessionId(request.sessionId))
        if ('error' in resolved) {
          if (resolved.error.code === 'session/not-found') throw new ApiSessionNotFound(resolved.error.message)
          throw resolved.error
        }
        combined.throwIfAborted()
        if (forking.has(session.sessionId)) throw Error('A fork is in progress')
        const turn = await service.ask(request.sessionId, request.requestId, request.question, combined)
        return { ok: true, value: { turn } }
      } catch (error) {
        if (error instanceof ApiSessionNotFound) return { ok: false, error: { code: 'session-not-found', message: error.message, details: {} } }
        return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : 'BTW failed', details: {} } }
      }
    }, endpoint)))
  }
}
