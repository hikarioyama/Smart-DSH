// Add or upgrade only BTW through the supported live user-patch layer. Never restart DSH.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.4.0-smart.4'
const [mode = '--check', homeArg = process.env.DSH_HOME ?? join(homedir(), '.dsh')] = process.argv.slice(2)
assert.ok(['--check', '--apply'].includes(mode), 'Usage: enable-live.mjs --check|--apply [DSH_HOME]')
const home = resolve(homeArg), profile = join(home, 'profiles/web')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tarball = join(root, `artifacts/dsh-btw-${VERSION}.tgz`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
assert.equal(sha256(await readFile(tarball)), '6bbee242950dcecfbb743a4ba65fc1bb7b4047cb3e1a7f847a243b9bdf20e383')
assert.match(execFileSync('dsh', ['--version'], { encoding: 'utf8' }).trim(), /(^|\s)0\.1\.5-rc\.2($|\s)/)
const manifestPath = join(profile, 'package.json')
const manifestText = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(manifestText)
assert.equal(manifest.dsh?.profile?.patchReload, 'live', 'Live patch reloading must be explicitly enabled')
assert.ok(!manifest.dependencies?.['dsh-btw'] && !manifest.dsh?.profile?.bundles?.includes('dsh-btw'), 'Refusing a second BTW installation')
const patchPath = join(profile, 'cordis.patch.yml')
const original = await readFile(patchPath, 'utf8')
// The running process keeps serving the path its loader row recorded; upgrades replace
// that directory's contents in place instead of moving to a new directory name.
const target = join(profile, 'bundles-src/dsh-btw-smart.3')
const entryPath = './bundles-src/dsh-btw-smart.3/lib/index.js'
const heading = `# Smart-DSH BTW ${VERSION} (separate, additive live entry)\n`
const addition = `- insert:\n    - id: btw\n      name: ${entryPath}\n      config:\n        timeoutMs: 120000\n`
const targetExists = await stat(target).then(() => true, error => {
  if (error.code === 'ENOENT') return false
  throw error
})
const installedVersion = targetExists ? JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).version : undefined
const hasEntry = original.includes(entryPath)
/**
 * Exactly three supported states. A fresh profile gets the entry and directory; an
 * upgrade rewrites the contents of the recorded directory under a backup; a matching
 * installed version is left alone. Anything else is inspected by hand.
 */
let updated = original, action, inPlace = false
if (hasEntry && targetExists && installedVersion === VERSION) {
  action = 'already-current'
} else if (hasEntry && targetExists) {
  action = `upgraded-in-place-from-${installedVersion}`
  inPlace = true
  if (!original.includes(heading)) {
    const headings = original.match(/# Smart-DSH BTW [^\n]*\n/g) ?? []
    assert.equal(headings.length, 1, 'Unexpected BTW heading; refusing to rewrite')
    updated = original.replace(headings[0], heading)
  }
} else if (!hasEntry && !targetExists) {
  assert.ok(!/\b(id:\s*btw|dsh-btw)\b/.test(original), 'Unrecognised BTW patch entry; inspect rather than duplicating it')
  updated = original.replace(/(^|\n)\[\]\s*$/, '$1') + '\n' + heading + addition
  action = 'added'
} else {
  throw new Error('BTW profile state is not an add or in-place upgrade; inspect it by hand')
}
if (mode === '--check') {
  console.log('Verified artifact/version/live policy. Planned action: ' + action + '. No files or processes changed.')
} else {
  assert.notEqual(action, 'already-current', 'Already current; nothing to apply')
  await mkdir(join(home, 'backups'), { recursive: true, mode: 0o700 })
  const backup = await mkdtemp(join(home, 'backups/btw-live-'))
  await writeFile(join(backup, 'cordis.patch.yml'), original, { mode: 0o600, flag: 'wx' })
  await writeFile(join(backup, 'manifest.json'), JSON.stringify({ action, target, patchPath, artifactSha256: sha256(await readFile(tarball)), beforeSha256: sha256(original), afterSha256: sha256(updated) }, null, 2), { mode: 0o600, flag: 'wx' })
  await mkdir(join(profile, 'bundles-src'), { recursive: true, mode: 0o700 })
  const staged = await mkdtemp(join(profile, 'bundles-src/.btw-stage-'))
  execFileSync('tar', ['-xzf', tarball, '-C', staged, '--strip-components=1'])
  const stagedManifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8'))
  assert.equal(stagedManifest.name, 'dsh-btw'); assert.equal(stagedManifest.version, VERSION)
  if (inPlace) {
    execFileSync('cp', ['-a', target, join(backup, 'bundle-before')])
    for (const name of await readdir(staged)) await cp(join(staged, name), join(target, name), { recursive: true, force: true })
  } else {
    await rename(staged, target)
  }
  // Do not clobber another settings edit between inspection and activation.
  assert.equal(await readFile(manifestPath, 'utf8'), manifestText, 'Concurrent profile change; staged code is not activated')
  assert.equal(await readFile(patchPath, 'utf8'), original, 'Concurrent patch edit; staged code is not activated')
  // The watched path stays in place, matching the live-add browser regression.
  if (updated !== original) await writeFile(patchPath, updated)
  console.log(JSON.stringify({ version: VERSION, action, target, backup, activation: 'live user-patch', servicesRestarted: false, gpuJobsTouched: false }, null, 2))
}
