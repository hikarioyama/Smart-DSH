import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshPackage } from './dsh-package.cjs'
import { patchClaimTokenColor } from './claim-token-color.mjs'

const target = join(resolveDshPackage('@deepseek-ai/dsh-client-ui-conversation'), 'lib/client.js')
const result = patchClaimTokenColor(readFileSync(target, 'utf8'))
if (result.changed) writeFileSync(target, result.source)
console.log(`claim-token-color: ${result.state}${result.changed ? ' (written)' : ' (already applied)'} ${target}`)
