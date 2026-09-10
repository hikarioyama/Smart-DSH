const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(__dirname + '/../patches/dsh-client-hmr-0.1.2-rc.1/client.js', 'utf8');
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
function world() {
  const channels = new Set(), sources = new Set(), queue = [];
  let owner, maximum = 0, opened = 0;
  function drain() {
    if (owner) return;
    const next = queue.shift();
    if (!next) return;
    if (next.signal.aborted) { next.reject(new DOMException('Aborted', 'AbortError')); drain(); return; }
    owner = next; next.acquired = true;
    Promise.resolve().then(next.callback).then(next.resolve, next.reject).finally(() => { owner = undefined; drain(); });
  }
  const locks = { request(name, options, callback) {
    assert.equal(name, 'dsh:client-hmr:/plugins/events:v1');
    return new Promise((resolve, reject) => {
      const entry = { callback, resolve, reject, signal: options.signal, acquired: false };
      options.signal.addEventListener('abort', () => {
        if (entry.acquired) return;
        const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
      queue.push(entry); drain();
    });
  }};
  class Channel {
    constructor(name) { this.name = name; this.listeners = []; channels.add(this); }
    addEventListener(type, fn) { assert.equal(type, 'message'); this.listeners.push(fn); }
    postMessage(data) { for (const peer of channels) if (peer !== this && peer.name === this.name) for (const fn of peer.listeners) fn({ data }); }
    close() { channels.delete(this); }
  }
  class Source {
    constructor(url) { assert.equal(url, '/plugins/events'); this.listeners = []; sources.add(this); opened++; maximum = Math.max(maximum, sources.size); }
    addEventListener(type, fn) { assert.equal(type, 'message'); this.listeners.push(fn); }
    emit(data) { for (const fn of this.listeners) fn({ data }); }
    close() { sources.delete(this); }
  }
  function tab(options = {}) {
    const state = { refreshed: 0, revisions: [], warnings: [], errors: [] };
    let exports, dispose;
    const context = {
      window: { __ModuleLoader__: { load: record => { exports = record.factory(() => { throw Error('Unexpected dependency'); }); } } },
      navigator: options.unsupported ? {} : { locks }, BroadcastChannel: Channel,
      AbortController, EventSource: Source,
      document: { querySelectorAll: () => [] },
    };
    vm.runInNewContext(code, context);
    const entry = { options: { name: 'test-plugin' }, refresh: async () => { state.refreshed++; } };
    exports.apply({
      modules: { invalidate: (_id, rev) => state.revisions.push(rev), prefetch: async () => {} },
      loader: { entries: () => [entry] },
      logger: { warn: (...args) => state.warnings.push(args), error: (...args) => state.errors.push(args) },
      effect: callback => { dispose = callback(); },
    });
    return { state, dispose: () => dispose() };
  }
  return { tab, sources, channels, get maximum() { return maximum; }, get opened() { return opened; } };
}
test('12 tabs use one SSE connection and all receive ordered rebuilds', async () => {
  const w = world(); const tabs = Array.from({ length: 12 }, () => w.tab()); await settle();
  assert.equal(w.sources.size, 1); assert.equal(w.maximum, 1);
  const source = [...w.sources][0];
  for (const rev of ['rev1', 'rev2']) source.emit(JSON.stringify({ type: 'rebuilt', id: 'test-plugin', rev }));
  await settle();
  for (const tab of tabs) { assert.equal(tab.state.refreshed, 2); assert.deepEqual(tab.state.revisions, ['rev1', 'rev2']); assert.equal(tab.state.errors.length, 0); }
  tabs.forEach(t => t.dispose()); await settle();
  assert.equal(w.sources.size, 0); assert.equal(w.channels.size, 0);
});
test('closing a waiting tab does not disturb leader; closing leader elects next tab', async () => {
  const w = world(); const a = w.tab(), b = w.tab(), c = w.tab(); await settle();
  const first = [...w.sources][0]; b.dispose(); await settle(); assert.equal([...w.sources][0], first);
  a.dispose(); await settle(); assert.equal(w.sources.size, 1); assert.notEqual([...w.sources][0], first); assert.equal(w.maximum, 1);
  [...w.sources][0].emit(JSON.stringify({ type: 'rebuilt', id: 'test-plugin', rev: 'next' })); await settle();
  assert.equal(c.state.refreshed, 1); assert.equal(a.state.refreshed, 0); assert.equal(b.state.refreshed, 0);
  c.dispose(); await settle(); assert.equal(w.sources.size, 0);
});
test('immediate and repeated disposal never leaks a connection or lock', async () => {
  const w = world(); const a = w.tab(); a.dispose(); a.dispose(); await settle(); assert.equal(w.sources.size, 0); assert.equal(w.opened, 0);
  const b = w.tab(); await settle(); assert.equal(w.sources.size, 1); b.dispose(); await settle(); assert.equal(w.sources.size, 0); assert.equal(w.channels.size, 0);
});
test('invalid frames remain rejected on leader and followers', async () => {
  const w = world(); const a = w.tab(), b = w.tab(); await settle();
  const source = [...w.sources][0]; source.emit('not json'); source.emit(JSON.stringify({ type: 'rebuilt', id: 1, rev: 'bad' }));
  await settle(); for (const tab of [a, b]) { assert.equal(tab.state.warnings.length, 2); assert.equal(tab.state.refreshed, 0); tab.dispose(); }
  await settle(); assert.equal(w.sources.size, 0);
});
test('unsupported browsers skip optional dev HMR instead of exhausting HTTP slots', async () => {
  const w = world(); const a = w.tab({ unsupported: true }); await settle();
  assert.equal(w.sources.size, 0); assert.equal(w.channels.size, 0); assert.equal(a.state.warnings.length, 1); a.dispose();
});
