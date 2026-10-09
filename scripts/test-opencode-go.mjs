import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { resolveDshPackage } from './dsh-package.cjs'

test('OpenCode Go resolves hoisted runtime dependencies and preserves settings through rdsh overrides', { skip: !process.env.SMART_DSH_RUNTIME }, t => {
  const home = mkdtempSync(join(tmpdir(), 'smart-ocgo-test-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = resolve(process.env.SMART_DSH_RUNTIME)
  const env = { ...process.env, HOME: home, DSH_HOME: home, DSH_PACKAGE_DIR: '', DSH_ROOT: '',
    RDSH_ORIG_BIN: join(root, 'lib/bin.js'), DSH_ORIG_BIN: '', PI_AI_DIR: '' }
  const manager = resolveDshPackage('@deepseek-ai/dsh-plugin-manager', { env })
  const yaml = createRequire(join(manager, 'package.json'))('yaml')
  const settings = join(home, 'settings.yaml')
  const original = '# Preserve this comment\nunrelated: true\nllm-pi-ai:\n  providers:\n    opencode-go:\n      headers:\n        x-opencode-session: test-session\n      models: []\n'
  writeFileSync(settings, original)
  function run(script, args = []) {
    const result = spawnSync(process.execPath, [new URL('../opencode-go/' + script, import.meta.url).pathname, ...args], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  run('apply.mjs', ['--dry-run'])
  assert.equal(readFileSync(settings, 'utf8'), original)
  assert.deepEqual(readdirSync(home), ['settings.yaml'])
  run('apply.mjs')
  const text = readFileSync(settings, 'utf8')
  assert.ok(text.includes('# Preserve this comment'))
  const doc = yaml.parse(text)
  assert.equal(doc.unrelated, true)
  const providers = doc['llm-pi-ai'].providers
  for (const name of ['opencode-go', 'opencode-go-completions', 'opencode-go-responses']) {
    assert.ok(providers[name].models.length)
    assert.equal(providers[name].headers['x-opencode-session'], 'test-session')
  }
  const ids = Object.values(providers).flatMap(provider => provider.models.map(model => model.id))
  assert.equal(new Set(ids).size, ids.length)
  const backup = join(home, 'backups', readdirSync(join(home, 'backups'))[0], 'settings.yaml')
  assert.equal(readFileSync(backup, 'utf8'), original)
  run('set-default-model.cjs', [settings, 'opencode-go', providers['opencode-go'].models[0].id])
  assert.equal(yaml.parse(readFileSync(settings, 'utf8'))['agent-default-model'].provider, 'opencode-go')
})
