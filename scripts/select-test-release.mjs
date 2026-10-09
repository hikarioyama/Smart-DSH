import { readFileSync, writeFileSync } from 'node:fs'

// CI-only dependency selection; production peer ranges continue to cover both.
const version = process.argv[2]
if (!['0.2.0-rc.2', '0.2.1-alpha.1'].includes(version)) throw Error('Unsupported test release')
const manifest = new URL('../dsh-btw/package.json', import.meta.url)
const info = JSON.parse(readFileSync(manifest, 'utf8'))
for (const name of Object.keys(info.devDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) info.devDependencies[name] = version
}
writeFileSync(manifest, JSON.stringify(info, null, 2) + '\n')
const workspace = new URL('../dsh-btw/pnpm-workspace.yaml', import.meta.url)
writeFileSync(workspace, readFileSync(workspace, 'utf8').replace(/0\.2\.(?:0-rc\.2|1-alpha\.1)/g, version))
