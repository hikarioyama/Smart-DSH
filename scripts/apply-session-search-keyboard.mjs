import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshPackage } from './dsh-package.cjs'
import { patchSessionSearchKeyboard } from './session-search-keyboard.mjs'
import { patchSessionSelectKeyboard } from './session-select-keyboard.mjs'

function applyPatch(label, name, patch) {
  const target = join(resolveDshPackage(name), 'lib/client.js')
  const result = patch(readFileSync(target, 'utf8'))
  if (result.changed) writeFileSync(target, result.source)
  console.log(`${label}: ${result.state}${result.changed ? ' (written)' : ' (already applied)'} ${target}`)
}

applyPatch('session-search-keyboard', '@deepseek-ai/dsh-client-ui-workspace', patchSessionSearchKeyboard)
applyPatch('session-select-keyboard', '@deepseek-ai/dsh-client-ui-conversation', patchSessionSelectKeyboard)
