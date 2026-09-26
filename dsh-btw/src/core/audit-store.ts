import { constants } from 'node:fs'
import { mkdir, open, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export interface Turn {
  id: string
  question: string
  at: number
  anchorSeq: number | null
  answer?: string
  error?: string
  durationMs?: number
}
export interface RecordV1 {
  version: 1
  sessionId: string
  type: 'question' | 'answer' | 'error' | 'fork'
  id: string
  at: number
  data: Record<string, unknown>
}

/** Versioned audit data, independent of DSH storage. Never prunes records. */
export class AuditStore {
  constructor(readonly root: string) {}
  private filename(sessionId: string): string {
    if (!sessionId || sessionId.length > 256) throw Error('Invalid session identity')
    return join(this.root, createHash('sha256').update(sessionId).digest('hex') + '.jsonl')
  }
  async records(sessionId: string): Promise<RecordV1[]> {
    let text: string
    try { text = await readFile(this.filename(sessionId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    if (text && !text.endsWith('\n')) throw Error('Incomplete audit tail; preserve file and repair before continuing')
    return text.split('\n').filter(Boolean).map(line => {
      const item = JSON.parse(line) as RecordV1
      if (item.version !== 1 || item.sessionId !== sessionId || typeof item.id !== 'string'
        || !['question', 'answer', 'error', 'fork'].includes(item.type) || !Number.isFinite(item.at)
        || item.data === null || typeof item.data !== 'object') throw Error('Invalid audit record; refusing to overwrite')
      return item
    })
  }
  /** Keep large request snapshots outside the small thread index. Content-addressed, immutable. */
  async snapshot(data: Record<string, unknown>): Promise<{ sha256: string }> {
    const text = JSON.stringify(data)
    const sha256 = createHash('sha256').update(text).digest('hex')
    const dir = join(this.root, 'contexts')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, sha256 + '.json')
    try {
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await file.writeFile(text); await file.sync() } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (createHash('sha256').update(await readFile(path)).digest('hex') !== sha256) throw Error('Damaged audit context; refusing reuse')
    }
    return { sha256 }
  }
  async turns(sessionId: string): Promise<Turn[]> {
    const turns = new Map<string, Turn>()
    for (const r of await this.records(sessionId)) {
      if (r.type === 'question') {
        if (turns.has(r.id) || typeof r.data.question !== 'string') throw Error('Duplicate or invalid question record')
        turns.set(r.id, { id: r.id, question: r.data.question, at: r.at,
          anchorSeq: typeof r.data.anchorSeq === 'number' ? r.data.anchorSeq : null })
      } else if (r.type === 'answer' || r.type === 'error') {
        const turn = turns.get(r.id)
        if (!turn) throw Error('Orphan audit result')
        if (r.type === 'answer' && typeof r.data.answer === 'string') turn.answer = r.data.answer
        else if (r.type === 'error' && typeof r.data.error === 'string') turn.error = r.data.error
        else throw Error('Invalid audit result')
        if (typeof r.data.durationMs === 'number') turn.durationMs = r.data.durationMs
      }
    }
    return [...turns.values()]
  }
  /** Caller serializes a session across the entire request, not just each append. */
  async append(sessionId: string, type: RecordV1['type'], id: string, data: Record<string, unknown>): Promise<void> {
    await this.records(sessionId) // Never append onto corrupt/incomplete data.
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const file = await open(this.filename(sessionId), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try {
      await file.writeFile(JSON.stringify({ version: 1, sessionId, type, id, at: Date.now(), data }) + '\n')
      await file.sync()
    } finally { await file.close() }
  }
}
