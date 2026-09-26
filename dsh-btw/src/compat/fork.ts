import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage, type AssistantMessage, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { AuditStore, Turn } from '../core/audit-store.js'

export interface ArchivedTurn { turn: Turn; message: AssistantMessage; stream: AssistantStreamRecord[] }
/** Uses real provider output, never fabricates an assistant stream. */
export function appendSideTurns(session: Session, turns: readonly ArchivedTurn[]): void {
  let number = session.snapshotEvents().filter(e => e.type === 'turn/start').reduce((n, e) => Math.max(n, e.data.turn), 0)
  for (const { turn, message, stream } of turns) {
    if (message.content.some(block => block.type === 'tool-call')) throw Error('Cannot fork a tool-only BTW answer; no tools were executed')
    number++
    session.append('turn/start', { turn: number })
    session.append('step/start', { turn: number, step: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: turn.question }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: number, step: 1, message, stream }, { surfaceOp: 'append' })
    session.append('step/end', { turn: number, step: 1 })
    session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
  }
}

export async function forkThread(ctx: Context, store: AuditStore, parentId: string, turnId: string): Promise<string> {
  const records = await store.records(parentId)
  const prior = records.findLast(r => r.type === 'fork' && r.id === turnId)
  if (prior) {
    if (prior.data.status !== 'complete' || typeof prior.data.childSessionId !== 'string') throw Error(`Prior fork ${prior.data.childSessionId ?? '(creation outcome unknown)'} requires inspection; refusing duplicate creation`)
    return prior.data.childSessionId as string
  }
  const turns = await store.turns(parentId)
  const index = turns.findIndex(t => t.id === turnId)
  const target = turns[index]
  if (!target || target.answer === undefined || target.anchorSeq === null) throw Error('A completed BTW answer and completed parent turn are required')
  const entries: ArchivedTurn[] = turns.slice(0, index + 1).filter(t => t.answer !== undefined).map(turn => {
    const archive = records.find(r => r.type === 'answer' && r.id === turn.id)?.data.archive as { message?: AssistantMessage; stream?: AssistantStreamRecord[] } | undefined
    if (!archive?.message || !archive.stream) throw Error('Exact answer stream missing; cannot fork this record')
    return { turn, message: archive.message, stream: archive.stream }
  })
  // Forking reads a completed prefix; it must not activate a cold parent Agent.
  const parent = await ctx.sessionController.inspect(SessionId(parentId))
  const prefix = parent.events.slice(0, target.anchorSeq + 1)
  // Validate all event shapes before creating anything persistent.
  const preview = Session.create(SessionId('btw-validation'), prefix)
  appendSideTurns(preview, entries)
  await store.append(parentId, 'fork', turnId, { status: 'requested', anchorSeq: target.anchorSeq })
  const fork = await ctx.sessionController.fork({ sessionId: SessionId(parentId), atSeq: target.anchorSeq })
  const child = ctx.agents.get(fork.sessionId)
  if (!child) throw Error(`Fork ${fork.sessionId} created but not live; do not repeat blindly`)
  const originalSeq = child.session.seq
  try {
    await store.append(parentId, 'fork', turnId, { childSessionId: String(fork.sessionId), status: 'created', anchorSeq: target.anchorSeq })
    if (child.session.seq !== originalSeq) throw Error('New fork changed before BTW insertion')
    appendSideTurns(child.session, entries)
    await ctx.sessionController.rename({ sessionId: fork.sessionId, title: 'BTW: ' + target.question.replace(/\s+/g, ' ').slice(0, 80) })
    await child.ctx.parallel(scopeTarget(child.session, child), 'session/flush', child.session)
    await store.append(parentId, 'fork', turnId, { childSessionId: String(fork.sessionId), status: 'complete', anchorSeq: target.anchorSeq })
  } catch (error) {
    throw Error(`Fork ${fork.sessionId} was created but completion failed; inspect it rather than creating another fork`, { cause: error })
  }
  return String(fork.sessionId)
}
