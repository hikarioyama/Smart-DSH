import { readFile, readdir } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'

describe('upgrade-cost boundaries', () => {
  it('keeps core free of DSH imports and production model calls free of private adapters', async () => {
    for (const file of await readdir(new URL('../src/core/', import.meta.url))) {
      const source = await readFile(new URL('../src/core/' + file, import.meta.url), 'utf8')
      expect(source).not.toContain('@deepseek-ai/')
    }
    const source = await readFile(new URL('../src/compat/model-call.ts', import.meta.url), 'utf8')
    expect(source).toContain('llm.prepareCall(')
    expect(source).not.toContain('btwPiAiAdapter')
    const built = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(built).not.toContain('dsh-llm-pi-ai')
    expect(built).not.toContain('PrivateSidechainKernel')
  })
})
