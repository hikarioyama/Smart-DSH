import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { patchClaimTokenColor } from './claim-token-color.mjs'

function packageDir() {
  if (process.env.DSH_PACKAGE_DIR) return realpathSync(process.env.DSH_PACKAGE_DIR)
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const cli = join(directory || '.', 'dsh')
    if (!existsSync(cli)) continue
    return dirname(createRequire(realpathSync(cli)).resolve('@deepseek-ai/dsh-client-ui-conversation/package.json'))
  }
  throw new Error('dsh was not found on PATH; set DSH_PACKAGE_DIR')
}

const target = join(packageDir(), 'lib/client.js')
const result = patchClaimTokenColor(readFileSync(target, 'utf8'))
if (result.changed) writeFileSync(target, result.source)
console.log(`claim-token-color: ${result.state}${result.changed ? ' (written)' : ' (already applied)'} ${target}`)
