import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, cp, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright-core'

const args = process.argv.slice(2)
let browserKind = 'chromium', liveAdd = false
while (args[0]?.startsWith('--')) {
  const flag = args.shift()
  if (flag === '--firefox') browserKind = 'firefox'
  else if (flag === '--live-add') liveAdd = true
  else throw Error('Unknown option: ' + flag)
}
const [cliArg, tarballArg, browserArg, ...addonDirs] = args
if (!cliArg || !tarballArg || !browserArg) throw Error('Usage: browser-profile.mjs [--firefox] [--live-add] <dsh/lib/bin.js> <plugin.tgz> <browser executable> [addon directories...]')
const cli = resolve(cliArg), tarball = resolve(tarballArg)
const runtime = resolve(dirname(cli), '../node_modules/@deepseek-ai')
const home = await mkdtemp(join(tmpdir(), 'smart-btw-browser-'))
// Isolate third-party auth discovery too, not just DSH's settings directory.
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'TMPDIR'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]))
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), DSH_HOME: home })
const checks = {}
let browserVersion
const redact = text => text.replace(/([?&]token=)[^\s]+/g, '$1<redacted>')
function launch(args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const done = new Promise((res, rej) => { child.once('error', rej); child.once('close', res) })
  return { child, done, output: () => output }
}
async function run(args) {
  const job = launch(args); const timer = setTimeout(() => job.child.kill(), 60000)
  try { assert.equal(await job.done, 0, redact(job.output()).slice(-3000)) } finally { clearTimeout(timer) }
}
async function waitFor(fn, label, ms = 45000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)) }
  throw Error('Timeout: ' + label)
}
const llmUrl = pathToFileURL(join(runtime, 'dsh-llm/lib/index.js')).href
const fixture = join(home, 'fixture.mjs')
await writeFile(fixture, `
import { LlmAdapter } from ${JSON.stringify(llmUrl)};
import { readFile, writeFile } from 'node:fs/promises';
const sessionFile = ${JSON.stringify(join(home, 'test-session-id'))};
export const name = 'btw-test-fixture';
export const inject = ['llm', 'sessionController', 'agents'];
export function apply(ctx) {
  class Adapter extends LlmAdapter {
    async *stream(options) {
      const last = options.messages.filter(m => m.role === 'user' && m.source?.kind === 'user').at(-1)?.content?.filter(b => b.type === 'text').map(b => b.text).join('') ?? '';
      const isSide = last.includes('side question from the user');
      if (isSide && options.provider !== 'btw-test-new') throw Error('REGRESSION: side request used stale provider');
      let answer = isSide ? 'BTW_TEST_ANSWER ' + last.split('\\n\\n').at(-1) : 'MAIN_TEST_READY';
      if (isSide && (last.includes('FOLLOWUP_CHECK') || last.includes('RESUME_CHECK'))) {
        if (!options.messages.some(m => m.role === 'assistant' && m.content.some(b => b.type === 'text' && b.text.includes('FIRST_CHECK')))) throw Error('Missing previous BTW answer');
        answer = 'BTW_HISTORY_CONFIRMED';
      }
      if (last.includes('MAIN_HOLD')) await new Promise(resolve => { const t = setTimeout(resolve, last.includes('LIVE_ADD') ? 20000 : 6000); options.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
      if (last.includes('CANCEL_CHECK')) await new Promise(resolve => { const t = setTimeout(resolve, 15000); options.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
      options.signal?.throwIfAborted();
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: answer };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['btw-test', 'btw-test-new'], new Adapter()));
  void (async () => {
    const saved = await readFile(sessionFile, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (saved) { console.log('BTW_TEST_SESSION=' + saved); return; }
    const {sessionId} = await ctx.sessionController.create({ cwd: ${JSON.stringify(home)} });
    await ctx.sessionController.selectModel({ sessionId, provider: 'btw-test', model: 'mock' });
    await ctx.sessionController.rename({ sessionId, title: 'BTW Browser Test' });
    await ctx.sessionController.prompt({ sessionId, requestId: 'test-main-setup', mode: 'queue', content: [{type:'text',text:'MAIN_SETUP'}] }, new AbortController().signal);
    const deadline = Date.now() + 10000;
    while (!ctx.agents.get(sessionId).session.snapshotEvents().some(e => e.type === 'turn/end')) {
      if (Date.now() > deadline) throw Error('Fixture main turn did not finish');
      await new Promise(r => setTimeout(r, 20));
    }
    // Switch without another main prompt: BTW must obey the pending selection.
    await ctx.sessionController.selectModel({ sessionId, provider: 'btw-test-new', model: 'mock' });
    await writeFile(sessionFile, sessionId, { mode: 0o600 });
    console.log('BTW_TEST_SESSION=' + sessionId);
  })().catch(e => console.log('BTW_FIXTURE_FAILURE=' + e.stack));
}
`)
const patch = join(home, 'fixture.yml')
await writeFile(patch, `- insert:\n    - id: btw-test-fixture\n      name: ${JSON.stringify(fixture)}\n- id: session-title-llm\n  disabled: true\n- id: session-telemetry-otel\n  disabled: true\n`)
let server, browser
try {
  if (!liveAdd) await run(['plugin', '--profile', 'web', 'add', '-w', tarball, '--ignore-scripts', '--config.auto-install-peers=false'])
  for (const source of addonDirs) {
    const target = join(home, 'profiles/web/bundles-src', basename(source))
    await mkdir(target, { recursive: true })
    for (const name of ['package.json', 'cordis.patch.yml', 'lib', 'sw', 'LICENSE']) {
      const from = join(source, name)
      if (await stat(from).catch(() => undefined)) await cp(from, join(target, name), { recursive: true })
    }
    await run(['plugin', '--profile', 'web', 'add', '-w', target, '--ignore-scripts', '--config.auto-install-peers=false'])
  }
  server = launch(['--profile', 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', '0'])
  const url = await waitFor(() => {
    if (server.child.exitCode !== null || server.output().includes('BTW_FIXTURE_FAILURE=')) throw Error(redact(server.output()).slice(-3000))
    return /http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*/.exec(server.output())?.[0]
  }, 'server URL')
  const sessionId = await waitFor(() => { if (server.output().includes('BTW_FIXTURE_FAILURE=')) throw Error(redact(server.output()).slice(-4000)); return /BTW_TEST_SESSION=(session-[a-z0-9-]+)/.exec(server.output())?.[1] }, 'fixture session')
  const browserEnv = { ...env, LIBGL_ALWAYS_SOFTWARE: '1', MOZ_WEBRENDER_SOFTWARE: '1', MOZ_ENABLE_WAYLAND: '0' }
  browser = await (browserKind === 'firefox' ? firefox : chromium).launch({
    executablePath: resolve(browserArg), headless: true, env: browserEnv,
    ...(browserKind === 'firefox' ? {
      // Playwright 1.58 uses WebDriver BiDi for moz-* channels: stock Firefox,
      // not a downloaded/patched Playwright Firefox or the user's open profile.
      channel: 'moz-firefox', args: ['--no-remote'],
      firefoxUserPrefs: { 'gfx.webrender.software': true, 'layers.acceleration.disabled': true },
    } : { args: ['--disable-gpu'] }),
  })
  browserVersion = browser.version()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  const watchErrors = target => {
    target.on('pageerror', e => errors.push(e.message))
    // A rejected suggestion source is caught by DSH, not an uncaught pageerror.
    target.on('console', e => { if (e.type() === 'error' && e.text().startsWith('[ui-input-trigger] source ')) errors.push(e.text()) })
  }
  watchErrors(page)
  await page.goto(url)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByText('Ungrouped', { exact: true }).click()
  await page.getByText('BTW Browser Test', { exact: true }).first().click({ timeout: 30000 })
  await page.getByText('MAIN_TEST_READY', { exact: true }).waitFor({ timeout: 30000 })
  checks.mainReady = true
  const mainInput = page.locator('[contenteditable="true"][role="textbox"]').first()
  await mainInput.fill('/co')
  await page.locator('[data-trigger-menu]').getByRole('option').filter({ hasText: /^compact/ }).waitFor()
  await mainInput.fill('')
  checks.standardCommandSuggestions = true
  if (liveAdd) {
    await mainInput.fill('MAIN_HOLD_LIVE_ADD'); await mainInput.press('Enter')
    await page.getByText(/Deep diving/).waitFor()
    const pid = server.child.pid
    const installer = join(dirname(fileURLToPath(import.meta.url)), 'enable-live.mjs')
    execFileSync(process.execPath, [installer, '--apply', home], { env, encoding: 'utf8' })
    await waitFor(async () => page.evaluate(async () => {
      const response = await fetch('/api/dsh-btw/fork', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'live-ready', method: 'dsh-btw/fork', payload: {} }) })
      const result = await response.json().catch(() => null)
      return result?.result?.error?.code === 'bad-request'
    }), 'live plugin host registration', 10000)
    await page.reload()
    await page.getByText(/Deep diving/).waitFor()
    assert.equal(server.child.pid, pid); assert.equal(server.child.exitCode, null)
    checks.liveAdditionWithoutRestart = true
  }
  await mainInput.fill('/btw FIRST_CHECK'); await mainInput.press('Enter')
  const panel = page.locator('[data-smart-btw]')
  await panel.getByText('BTW_TEST_ANSWER FIRST_CHECK', { exact: true }).waitFor({ timeout: 15000 })
  if (liveAdd) {
    assert.ok(await page.getByText(/Deep diving/).isVisible(), 'Live addition must not interrupt the running main request')
    await page.getByText(/Deep diving/).waitFor({ state: 'hidden', timeout: 25000 })
    assert.equal(await page.getByText('MAIN_TEST_READY', { exact: true }).count(), 2)
    checks.mainSurvivedLiveAddition = true
  }
  await panel.getByRole('textbox', { name: 'BTW follow-up' }).fill('FOLLOWUP_CHECK')
  await panel.getByRole('button', { name: 'Ask BTW', exact: true }).click()
  await panel.getByText('BTW_HISTORY_CONFIRMED', { exact: true }).waitFor()
  checks.followupContext = true
  if (!liveAdd) checks.modelSwitchBeforeMainPrompt = true
  for (const q of ['THIRD_CHECK', 'FOURTH_CHECK']) {
    await panel.getByRole('textbox').fill(q); await panel.getByRole('button', { name: 'Ask BTW', exact: true }).click()
    await panel.getByText('BTW_TEST_ANSWER ' + q, { exact: true }).waitFor()
  }
  assert.equal(await panel.getByRole('article').count(), 4, 'the panel keeps the thread being worked on')
  // The panel must render as a DSH composer-width card, not a narrower annex.
  const composerBox = await page.locator('[data-composer-card]').first().boundingBox()
  const panelBox = await panel.boundingBox()
  assert.ok(composerBox && panelBox, 'composer and panel must both be laid out')
  assert.ok(Math.abs(composerBox.width - panelBox.width) <= 1, `panel width ${panelBox.width} must equal composer width ${composerBox.width}`)
  checks.composerWidthMatch = true
  const before = await panel.boundingBox()
  const handle = await panel.getByRole('separator').boundingBox()
  const layout = await page.evaluate(() => {
    const seat = document.querySelector('[class*="composerSeat"]')
    const rect = el => el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width) } : null
    return { innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, seat: rect(seat), card: rect(document.querySelector('[data-composer-card]')) }
  })
  // The panel must occupy the same column box as the DSH composer card; an
  // upstream/driver viewport quirk shifting that whole column is not panel drift.
  const card = layout.card
  assert.ok(before && card, 'composer and panel must both be laid out')
  assert.ok(Math.abs(before.width - card.w) <= 1 && Math.abs(before.x - card.x) <= 1,
    `panel must match the composer card: panel=${JSON.stringify(before)} layout=${JSON.stringify(layout)}`)
  const dragX = Math.min(Math.max(before.x + before.width / 2, 1), layout.innerWidth - 2)
  assert.ok(handle && handle.y > 0, `resize separator must be laid out: handle=${JSON.stringify(handle)} layout=${JSON.stringify(layout)}`)
  await page.mouse.move(dragX, handle.y + 7); await page.mouse.down()
  await page.mouse.move(dragX, handle.y - 120, { steps: 8 }); await page.mouse.up()
  const after = await panel.boundingBox(); assert.ok(after.height > before.height + 90)
  checks.dragResize = true
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await waitFor(async () => !(await panel.isVisible()), 'close hides the panel')
  // Closing must reveal nothing: `/btw` alone offers the command, never a list of
  // questions asked earlier.
  await mainInput.fill('/btw')
  await page.locator('[data-trigger-menu]').getByRole('option').filter({ hasText: /^btw/ }).waitFor()
  assert.equal(await page.locator('[data-smart-btw]').count(), 0, 'No panel may appear without a question')
  assert.equal(await page.getByLabel('Recent BTW questions').count(), 0)
  await mainInput.fill('')
  checks.noStoredQuestionSurface = true
  // A new /btw starts its own view instead of restoring the previous thread.
  await mainInput.fill('/btw NEW_THREAD_CHECK'); await mainInput.press('Enter')
  await panel.getByText('BTW_TEST_ANSWER NEW_THREAD_CHECK', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('article').count(), 1)
  assert.equal(await panel.getByText('FOURTH_CHECK', { exact: true }).count(), 0)
  checks.freshThreadView = true
  await mainInput.fill('MAIN_HOLD'); await mainInput.press('Enter')
  await page.getByText(/Deep diving/).waitFor()
  await panel.getByRole('textbox').fill('PARALLEL_CHECK')
  await panel.getByRole('button', { name: 'Ask BTW', exact: true }).click()
  await panel.getByText('BTW_TEST_ANSWER PARALLEL_CHECK', { exact: true }).waitFor()
  assert.ok(await page.getByText(/Deep diving/).isVisible(), 'BTW must finish while main is still running')
  checks.parallelWithMain = true
  await page.getByText(/Deep diving/).waitFor({ state: 'hidden', timeout: 15000 })
  await panel.getByRole('textbox').fill('CANCEL_CHECK')
  await panel.getByRole('button', { name: 'Ask BTW', exact: true }).click()
  await panel.getByRole('button', { name: 'Cancel BTW', exact: true }).click()
  await panel.getByRole('button', { name: 'Cancel BTW', exact: true }).waitFor({ state: 'hidden' })
  checks.explicitCancel = true
  // Compact viewport: collapse only through the public accessible sidebar control.
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.setViewportSize({ width: 412, height: 915 })
  const collapseMobile = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapseMobile.isVisible()) await collapseMobile.click()
  await waitFor(async () => (await panel.boundingBox())?.width > 240, 'readable narrow panel')
  const mobileBox = await panel.boundingBox()
  assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 413)
  assert.ok((await panel.getByRole('button', { name: 'Ask BTW', exact: true }).boundingBox()).y < 915)
  checks.narrowViewport = true
  await page.screenshot({ path: join(home, 'mobile.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  // DSH's own branch action forks the displayed answer, using the recorded anchor
  // so later main and side turns stay out of the child.
  await panel.getByRole('button', { name: 'Branch into a new conversation' }).first().click()
  await waitFor(async () => !(await panel.isVisible()), 'open fork', 15000)
  await page.getByText('BTW_TEST_ANSWER NEW_THREAD_CHECK', { exact: true }).waitFor()
  checks.forkVisible = true
  // Read only test-owned audit files: every exchange is still recorded even though
  // the panel never restores them.
  const { readdir } = await import('node:fs/promises')
  const dir = join(home, 'btw-threads/v1')
  const auditRecords = async () => (await readFile(join(dir, (await readdir(dir)).find(f => f.endsWith('.jsonl'))), 'utf8')).trim().split('\n').map(JSON.parse)
  const records = await auditRecords()
  assert.equal(records.filter(r => r.type === 'question').length, 7)
  assert.equal(records.filter(r => r.type === 'answer').length, 6)
  assert.equal(records.filter(r => r.type === 'error').length, 1)
  assert.equal(records.at(-1).data.status, 'complete')
  checks.auditAndForkDurability = true
  // Node's zstdDecompressSync decodes only the first concatenated frame here.
  // DSH appends frames; the zstd CLI reads the complete stream.
  const sessionFiles = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name === 'session.v3.jsonl.zstd') sessionFiles.push(path)
    }
  }
  await walk(join(home, 'sessions'))
  const logs = await Promise.all(sessionFiles.map(async file => execFileSync('zstd', ['-dc', file], { maxBuffer: 32 * 1024 * 1024 }).toString('utf8').trim().split('\n').map(JSON.parse)))
  const parent = logs.find(rows => rows[0].id === sessionId)
  const child = logs.find(rows => rows[0].id === records.at(-1).data.childSessionId)
  const userTexts = rows => rows.filter(r => r.type === 'user/message' && r.data.source?.kind === 'user').map(r => r.data.content.filter(p => p.type === 'text').map(p => p.text).join(''))
  const mainPrefix = liveAdd ? ['MAIN_SETUP', 'MAIN_HOLD_LIVE_ADD'] : ['MAIN_SETUP']
  assert.deepEqual(userTexts(parent), [...mainPrefix, 'MAIN_HOLD'])
  // The child stops at the recorded anchor: the later main and side turns stay out.
  // Earlier side threads are still recorded in the audit, so they are included —
  // fork reproduces the recorded side history, not just the current panel view.
  assert.deepEqual(userTexts(child), [...mainPrefix, 'FIRST_CHECK', 'FOLLOWUP_CHECK', 'THIRD_CHECK', 'FOURTH_CHECK', 'NEW_THREAD_CHECK'])
  assert.ok(child.some(r => r.type === 'session/title'))
  assert.equal(child.filter(r => r.type === 'turn/start').length, child.filter(r => r.type === 'turn/end').length)
  checks.parentLogUntouchedByBtw = true
  checks.forkDiskReadback = true
  checks.forkUsesRecordedAnchor = true
  await page.screenshot({ path: join(home, 'fork.png') })
  await page.close()
  // Stop only the fixture server, then prove disk recovery in a new process.
  server.child.kill(); await server.done
  await writeFile(join(home, 'server-before-restart.log'), redact(server.output()))
  server = launch(['--profile', 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', '0'])
  const restartedUrl = await waitFor(() => {
    if (server.child.exitCode !== null || server.output().includes('BTW_FIXTURE_FAILURE=')) throw Error(redact(server.output()).slice(-3000))
    return /http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*/.exec(server.output())?.[0]
  }, 'restarted server URL')
  const login = await fetch(restartedUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie)
  const call = (endpoint, payload, timeout = 15000) => fetch(new URL('/api/dsh-btw/' + endpoint, restartedUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, signal: AbortSignal.timeout(timeout),
    body: JSON.stringify({ type: 'client-request', rpcId: 'restart-' + endpoint + '-' + Math.random(), method: 'dsh-btw/' + endpoint, payload }),
  })
  // The stored-question surface is gone from the wire, not merely hidden in the UI.
  const removedBody = await (await call('history', { sessionId })).json().catch(() => null)
  assert.ok(removedBody?.result?.ok !== true, 'no history endpoint may be served')
  checks.noHistoryEndpoint = true
  // Repeated fork of a completed turn reuses the recorded child: one durable fork,
  // no second session, and no activation of the cold parent Agent.
  const forkTurn = records.at(-1).id
  const firstFork = (await (await call('fork', { sessionId, turnId: forkTurn })).json()).result
  const secondFork = (await (await call('fork', { sessionId, turnId: forkTurn })).json()).result
  assert.deepEqual(firstFork, secondFork)
  assert.equal(firstFork.value.childSessionId, records.at(-1).data.childSessionId)
  assert.equal((await auditRecords()).filter(r => r.type === 'fork' && r.data.status === 'complete').length, 1)
  sessionFiles.length = 0; await walk(join(home, 'sessions'))
  assert.equal(sessionFiles.length, 2, 'Repeated fork must not create another session')
  checks.serverRestartForkReuse = true
  const restored = await context.newPage()
  watchErrors(restored)
  await restored.goto(restartedUrl)
  // A new loopback port has no remembered active session: wait for the app,
  // not the Chat toolbar that appears only after selecting a conversation.
  await restored.getByText('New Session', { exact: true }).first().waitFor()
  const reopen = restored.getByRole('button', { name: 'Open sidebar', exact: true })
  if (await reopen.isVisible()) await reopen.click()
  const parentTitle = restored.getByText('BTW Browser Test', { exact: true }).and(restored.locator(':not([disabled])')).first()
  if (!(await parentTitle.isVisible())) await restored.getByText('Ungrouped', { exact: true }).click()
  await parentTitle.click()
  await restored.getByText('MAIN_TEST_READY', { exact: true }).first().waitFor()
  await restored.locator('[contenteditable="true"][role="textbox"]').first().fill('/btw')
  await restored.locator('[data-trigger-menu]').getByRole('option').filter({ hasText: /^btw/ }).waitFor()
  assert.equal(await restored.locator('[data-smart-btw]').count(), 0, 'a restarted DSH must not surface stored questions')
  assert.equal(await restored.getByLabel('Recent BTW questions').count(), 0)
  checks.noHistoryAfterRestart = true
  assert.deepEqual(errors, [])
  checks.browserErrors = 0
  await restored.screenshot({ path: join(home, 'restarted.png') })
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0]
    if (page) { await page.screenshot({ path: join(home, 'failure.png') }); await writeFile(join(home, 'failure.txt'), (await page.locator('body').innerText()).slice(-20000)) }
  }
  throw error
} finally {
  if (browser) await browser.close()
  if (server) { server.child.kill(); await server.done; await writeFile(join(home, 'server.log'), redact(server.output())) }
  const report = { home, browser: browserKind, browserVersion, liveAdd, addons: addonDirs.map(path => basename(path)), checks, realModelCalls: 0, productionTouched: false }
  await writeFile(join(home, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
