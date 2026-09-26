import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { patchSessionSearchKeyboard } from './session-search-keyboard.mjs'
import { patchSessionSelectKeyboard } from './session-select-keyboard.mjs'

function packageDir(name) {
  if (process.env.DSH_PACKAGE_DIR) return realpathSync(process.env.DSH_PACKAGE_DIR)
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const cli = join(directory || '.', 'dsh')
    if (!existsSync(cli)) continue
    return dirname(createRequire(realpathSync(cli)).resolve(`${name}/package.json`))
  }
  throw new Error('dsh was not found on PATH; set DSH_PACKAGE_DIR')
}

function applyPatch(label, name, patch) {
  const target = join(packageDir(name), 'lib/client.js')
  const result = patch(readFileSync(target, 'utf8'))
  if (result.changed) writeFileSync(target, result.source)
  console.log(`${label}: ${result.state}${result.changed ? ' (written)' : ' (already applied)'} ${target}`)
}

applyPatch('session-search-keyboard', '@deepseek-ai/dsh-client-ui-workspace', patchSessionSearchKeyboard)
applyPatch('session-select-keyboard', '@deepseek-ai/dsh-client-ui-conversation', patchSessionSelectKeyboard)
