import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { resolvePackageFrom } from './dsh-package.cjs'
import { patchSessionSearchKeyboard } from './session-search-keyboard.mjs'
import { patchSessionSelectKeyboard } from './session-select-keyboard.mjs'
import { patchClaimTokenColor } from './claim-token-color.mjs'

test('optional UI patches apply to the real current runtime and remain idempotent', { skip: !process.env.SMART_DSH_RUNTIME }, () => {
  const entry = join(process.env.SMART_DSH_RUNTIME, 'lib/bin.js')
  for (const [target, patch] of [
    ['workspace', patchSessionSearchKeyboard],
    ['conversation', patchSessionSelectKeyboard],
    ['conversation', patchClaimTokenColor],
  ]) {
    const root = resolvePackageFrom('@deepseek-ai/dsh-client-ui-' + target, entry)
    const source = readFileSync(join(root, 'lib/client.js'), 'utf8')
    const first = patch(source)
    assert.equal(first.state, 'patched', target)
    new Script(first.source)
    const second = patch(first.source)
    assert.equal(second.changed, false, target)
    assert.equal(second.source, first.source)
  }
})
