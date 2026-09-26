import { BTW_ASK_ENDPOINT, BTW_FORK_ENDPOINT, readTurn, type BtwTurn } from '../shared/protocol.js'

export interface Transport {
  rpc: { call(channel: string, method: string, payload: unknown, signal: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }> }
}
export interface PanelState { open: boolean; busy: boolean; turns: BtwTurn[]; question: string; error: string | null }
/**
 * Pure state machine; no DSH, DOM or React dependency.
 *
 * The panel only shows the thread the user is working on now: nothing is restored
 * from the audit store, and a new `/btw` from the main composer starts a fresh
 * view while panel follow-ups append to it. Every exchange is still recorded in
 * the audit store, and fork reads that store through the host.
 */
export class BtwController {
  private value: PanelState = { open: false, busy: false, turns: [], question: '', error: null }
  private listeners = new Set<() => void>()
  readonly state = {
    getSnapshot: () => this.value,
    subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
  }
  private active: AbortController | undefined
  private disposed = false
  constructor(private readonly connection: Transport, readonly sessionId: string, private readonly timeoutMs = 125000) {}
  private set(patch: Partial<PanelState>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener() }
  open(): void { this.set({ open: true }) }
  ask(raw: string, fresh = false): Promise<{ kind: 'success' } | { kind: 'error'; text: string }> {
    const question = raw.trim()
    // There is no stored history to reveal, so a bare `/btw` opens nothing.
    if (!question) return Promise.resolve({ kind: 'error', text: 'Type a question after /btw' })
    if (question.length > 32000) return Promise.resolve({ kind: 'error', text: 'Question exceeds 32000 characters' })
    if (this.value.busy) return Promise.resolve({ kind: 'error', text: 'Wait for the current BTW answer or cancel it first' })
    const control = new AbortController(); this.active = control
    this.set({ open: true, busy: true, question, error: null, ...(fresh ? { turns: [] } : {}) })
    void this.run(question, control)
    return Promise.resolve({ kind: 'success' })
  }
  private async run(question: string, control: AbortController): Promise<void> {
    try {
      const requestId = crypto.randomUUID()
      const result = await this.connection.rpc.call('/api', BTW_ASK_ENDPOINT, { sessionId: this.sessionId, question, requestId }, AbortSignal.any([control.signal, AbortSignal.timeout(this.timeoutMs)]))
      if (this.disposed || control.signal.aborted) return
      if (!result.ok) throw Error(result.error.message)
      const turn = readTurn((result.value as { turn?: unknown })?.turn)
      if (!turn || turn.id !== requestId) throw Error('Invalid BTW response')
      this.set({ turns: [...this.value.turns.filter(t => t.id !== turn.id), turn], question: '' })
    } catch (error) {
      if (!this.disposed) this.set({ error: control.signal.aborted ? 'Cancelled; audit record retained' : error instanceof Error ? error.message : 'BTW failed' })
    } finally {
      if (this.active === control) {
        this.active = undefined
        if (!this.disposed) this.set({ busy: false })
      }
    }
  }
  async fork(turnId: string): Promise<string> {
    const result = await this.connection.rpc.call('/api', BTW_FORK_ENDPOINT, { sessionId: this.sessionId, turnId }, AbortSignal.timeout(30000))
    if (!result.ok) throw Error(result.error.message)
    const child = (result.value as { childSessionId?: unknown })?.childSessionId
    if (typeof child !== 'string') throw Error('Invalid fork result')
    return child
  }
  cancel(): void { this.active?.abort() }
  dismiss(): void { this.set({ open: false }) }
  dispose(): void { this.disposed = true; this.active?.abort(); this.set({ open: false, busy: false }); this.listeners.clear() }
}
