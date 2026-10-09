import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import * as ReactJsx from 'react/jsx-runtime'
import * as Store from '@deepseek-ai/dsh-client-store'

describe('prebuilt client artifact', () => {
  it('loads against the new platform module table and disposes session-owned controllers', async () => {
    const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    let plugin: { apply(ctx: unknown): void } | undefined
    const modules: Record<string, unknown> = {
      react: React, 'react/jsx-runtime': ReactJsx,
      '@deepseek-ai/dsh-client-store': Store,
      '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
    }
    runInNewContext(code, { queueMicrotask, window: { __ModuleLoader__: { load(entry: { id: string; factory(require: (id: string) => unknown): typeof plugin }) {
      expect(entry.id).toBe('dsh-btw')
      plugin = entry.factory(id => { expect(modules).toHaveProperty(id); return modules[id] })
    } } } })
    const cleanup: Array<() => void> = []
    const effect = (callback: () => (() => void)) => { cleanup.push(callback()) }
    let registration: { inject(id: string): { openChild(id: string): Promise<void>; controller: { state: { getSnapshot(): unknown }; dispose(): void } } } | undefined
    const input = { state: { subscribe: () => () => {}, getSnapshot: () => ({ phase: 'plain', draft: '', occurrences: [] }) } }
    const conversation = { input: { for: () => input } }
    const services = {
      connection: {}, inputTriggers: { registerSource: () => () => {} },
      sessions: { scope: () => ({ effect }) },
    }
    const openSession = vi.fn()
    const refresh = vi.fn(async () => {})
    Object.assign(services.sessions, { refresh })
    const ctx = { conversation, uiWorkspace: { openSession }, effect, get: (key: keyof typeof services) => services[key], slots: {
      inject: (_name: string, callback: () => void) => callback(),
      register: (options: typeof registration) => { registration = options; return () => {} },
    } }
    expect(plugin).toBeDefined()
    plugin!.apply(ctx)
    await registration!.inject('one').openChild('fork-child')
    expect(refresh).toHaveBeenCalledOnce()
    expect(openSession).toHaveBeenCalledWith('fork-child')
    const first = registration!.inject('one').controller
    expect(first.state.getSnapshot()).toMatchObject({ open: false, busy: false })
    expect(registration!.inject('one').controller).toBe(first)
    for (const dispose of cleanup.reverse()) dispose()
    expect(first.state.getSnapshot()).toMatchObject({ open: false, busy: false })
    expect(code).not.toContain('dsh-client-runtime')
    expect(code).toContain('MarkdownText')
  })
})
