import { AuditStore, type Turn } from './audit-store.js'

export interface Answer { response: string; usage?: unknown; archive?: unknown; cacheStrategy: string }
export interface SideContext { anchorSeq: number | null; audit: Record<string, unknown> }
export interface ThreadDeps<C extends SideContext> {
  snapshot(sessionId: string, history: Turn[], question: string): C
  generate(context: C, requestId: string, signal: AbortSignal): Promise<Answer>
}
/** One active request per parent; independent parents remain concurrent. */
export class ThreadService<C extends SideContext> {
  private readonly busy = new Set<string>()
  constructor(readonly store: AuditStore, private readonly deps: ThreadDeps<C>) {}
  isBusy(sessionId: string) { return this.busy.has(sessionId) }
  history(sessionId: string) { return this.store.turns(sessionId) }
  async ask(sessionId: string, id: string, question: string, signal: AbortSignal): Promise<Turn> {
    if (this.busy.has(sessionId)) throw Error('A BTW request is already running in this session')
    this.busy.add(sessionId)
    try {
      signal.throwIfAborted()
      const turns = await this.history(sessionId)
      const prior = turns.find(t => t.id === id)
      if (prior) {
        if (prior.question !== question) throw Error('Request identity reused with different question')
        if (prior.answer !== undefined) return prior
        throw Error(prior.error ?? 'Previous request was interrupted; use a new request identity')
      }
      const context = this.deps.snapshot(sessionId, turns, question)
      const started = Date.now()
      const request = await this.store.snapshot(context.audit)
      await this.store.append(sessionId, 'question', id, {
        question, anchorSeq: context.anchorSeq, request, historyIds: turns.filter(t => t.answer !== undefined).map(t => t.id),
      })
      try {
        signal.throwIfAborted()
        const result = await this.deps.generate(context, id, signal)
        signal.throwIfAborted()
        await this.store.append(sessionId, 'answer', id, { answer: result.response,
          cacheStrategy: result.cacheStrategy, ...(result.archive === undefined ? {} : { archive: result.archive }), ...(result.usage === undefined ? {} : { usage: result.usage }),
          durationMs: Date.now() - started })
      } catch (error) {
        // No success without durable audit. A second write failure propagates too.
        await this.store.append(sessionId, 'error', id, {
          error: signal.aborted ? 'cancelled-or-timeout' : 'generation-or-audit-failed', durationMs: Date.now() - started })
        throw error
      }
      const turn = (await this.history(sessionId)).find(t => t.id === id)
      if (!turn) throw Error('Audit result missing')
      return turn
    } finally { this.busy.delete(sessionId) }
  }
}
