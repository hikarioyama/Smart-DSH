import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// No real user Profile or credentials are read or modified. Model calls are
// intentionally excluded: this is installation/start/transport/uninstall evidence.
const [cliArg, tarballArg, storeArg] = process.argv.slice(2)
if (!cliArg || !tarballArg) throw new Error('Usage: node scripts/smoke-profile.mjs <dsh/lib/bin.js> <plugin.tgz> [pnpm-store]')
const cli = resolve(cliArg)
const tarball = resolve(tarballArg)
const home = await mkdtemp(join(tmpdir(), 'dsh-btw-profile-'))
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'TMPDIR'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]))
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), DSH_HOME: home })
const store = storeArg ? ['--store-dir', resolve(storeArg)] : []
const cwd = dirname(cli)
const packageJson = JSON.parse(await readFile(join(cwd, '..', 'package.json'), 'utf8'))
const report = { dsh: packageJson.version, node: process.version, home, checks: {} }
const redact = text => text.replace(/([?&]token=)[^\s]+/g, '$1<redacted>')

function launch(args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data.toString() })
  child.stderr.on('data', data => { output += data.toString() })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code))
  })
  return { child, done, output: () => output }
}

async function run(args) {
  const job = launch(args)
  const timeout = setTimeout(() => job.child.kill(), 60_000)
  try {
    const code = await job.done
    if (code !== 0) throw new Error(redact(job.output()).slice(-5000))
    return job.output()
  } finally { clearTimeout(timeout) }
}

async function ready(job) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const url = /http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*/.exec(job.output())?.[0]
    if (url) return new URL(url)
    if (job.child.exitCode !== null) throw new Error(redact(job.output()).slice(-5000))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Startup timeout: ' + redact(job.output()).slice(-3000))
}

let server
try {
  await run(['plugin', '--profile', 'web', 'add', '-w', tarball, '--ignore-scripts', '--config.auto-install-peers=false', ...store])
  report.checks.install = 'passed'
  const composed = await run(['--profile', 'web', '--dump-config'])
  assert.match(composed, /id: btw\b/)
  report.checks.composedEntry = 'passed'
  server = launch(['--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'])
  const url = await ready(server)
  report.checks.start = 'passed'
  const api = new URL('/api/dsh-btw/ask', url)
  const rpc = (payload, headers = {}) => fetch(api, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'client-request', rpcId: 'smoke-id', method: 'dsh-btw/ask', payload }),
  })
  assert.equal((await rpc({})).status, 401)
  for (const endpoint of ['fork']) {
    const response = await fetch(new URL('/api/dsh-btw/' + endpoint, url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'auth-test', method: 'dsh-btw/' + endpoint, payload: {} }),
    })
    assert.equal(response.status, 401)
  }
  report.checks.unauthenticatedRejected = 'passed (ask/fork)'
  const login = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie, 'DSH startup URL must mint an authenticated browser cookie')
  const authenticated = { cookie }
  const bad = await rpc({}, authenticated)
  assert.equal(bad.status, 200)
  assert.equal((await bad.json()).result.error.code, 'bad-request')
  const missing = await rpc({ requestId: 'smoke', sessionId: 'nonexistent-smoke-session', question: 'hello' }, authenticated)
  assert.equal((await missing.json()).result.error.code, 'session-not-found')
  report.checks.authenticatedRpc = 'passed'
  report.checks.realModelCall = 'not-run'
} finally {
  if (server) { server.child.kill(); await server.done }
  try {
    await run(['plugin', '--profile', 'web', 'remove', '-w', 'dsh-btw', ...store])
    const composed = await run(['--profile', 'web', '--dump-config'])
    assert.doesNotMatch(composed, /id: btw\b/)
    report.checks.uninstall = 'passed'
  } finally { console.log(JSON.stringify(report, null, 2)) }
}
