import { appendFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { BtwContextSnapshot } from './context-snapshot.js'
import type { BtwOneShotResult } from './one-shot.js'

export type SidechainMode = 'private-jsonl' | 'memory' | 'none'

export interface SidechainConfig {
  readonly mode?: SidechainMode
  readonly root?: string
  readonly retentionDays?: number
  readonly maxSessions?: number
}

interface SidechainStart {
  readonly version: 1
  readonly type: 'start'
  readonly sidechainId: string
  readonly parentSessionId: string
  readonly createdAt: string
  readonly question: string
  readonly request: BtwContextSnapshot
}

interface SidechainEnd {
  readonly version: 1
  readonly type: 'end'
  readonly sidechainId: string
  readonly completedAt: string
  readonly outcome:
    | { readonly kind: 'success'; readonly result: BtwOneShotResult }
    | { readonly kind: 'error'; readonly message: string }
}

interface MemoryTranscript {
  readonly start: SidechainStart
  end?: SidechainEnd
}

const PRIVATE_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/iu

export class PrivateSidechainKernel {
  readonly mode: SidechainMode
  readonly root: string
  private readonly retentionMs: number
  private readonly maxSessions: number
  private readonly memory = new Map<string, MemoryTranscript>()

  constructor(config: SidechainConfig = {}) {
    this.mode = config.mode ?? 'private-jsonl'
    this.root = resolve(config.root ?? join(resolveDshHome(), 'btw-sidechains', 'v1'))
    this.retentionMs = (config.retentionDays ?? 7) * 24 * 60 * 60 * 1000
    this.maxSessions = config.maxSessions ?? 500
  }

  createId(): string {
    return randomUUID()
  }

  async begin(
    question: string,
    request: BtwContextSnapshot,
    sidechainId = this.createId(),
  ): Promise<string> {
    if (this.mode === 'none') return sidechainId
    const start: SidechainStart = {
      version: 1,
      type: 'start',
      sidechainId,
      parentSessionId: request.parentSessionId,
      createdAt: new Date().toISOString(),
      question,
      request,
    }
    if (this.mode === 'memory') {
      this.memory.set(sidechainId, { start })
      this.pruneMemory()
      return sidechainId
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeFile(this.filename(sidechainId), `${JSON.stringify(start)}\n`, { flag: 'wx', mode: 0o600 })
    return sidechainId
  }

  async finish(sidechainId: string, outcome: SidechainEnd['outcome']): Promise<void> {
    if (this.mode === 'none') return
    const end: SidechainEnd = {
      version: 1,
      type: 'end',
      sidechainId,
      completedAt: new Date().toISOString(),
      outcome,
    }
    if (this.mode === 'memory') {
      const transcript = this.memory.get(sidechainId)
      if (transcript !== undefined) transcript.end = end
      return
    }
    await appendFile(this.filename(sidechainId), `${JSON.stringify(end)}\n`, { encoding: 'utf8' })
    await this.pruneFiles()
  }

  private filename(sidechainId: string): string {
    return join(this.root, `${sidechainId}.jsonl`)
  }

  private pruneMemory(): void {
    while (this.memory.size > this.maxSessions) {
      const oldest = this.memory.keys().next().value as string | undefined
      if (oldest === undefined) return
      this.memory.delete(oldest)
    }
  }

  private async pruneFiles(): Promise<void> {
    const names = (await readdir(this.root)).filter(name => PRIVATE_FILE.test(name))
    const rows = await Promise.all(names.map(async name => ({ name, info: await stat(join(this.root, name)) })))
    rows.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs)
    const now = Date.now()
    const removals = rows.filter((row, index) =>
      index >= this.maxSessions || now - row.info.mtimeMs > this.retentionMs)
    await Promise.all(removals.map(row => unlink(join(this.root, row.name))))
  }
}
