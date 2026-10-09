const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(__dirname + '/../patches/dsh-client-hmr-0.2.0-rc.2/client.js', 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function world() {
  const channels = new Set(), sources = new Set(), locks = new Map();
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    addEventListener(_event, receive) { this.receive = receive; }
    postMessage(data) { for (const peer of channels) if (peer !== this && peer.name === this.name) peer.receive({ data }); }
    close() { channels.delete(this); }
  }
  class Source {
    constructor(url) { this.url = url; sources.add(this); }
    addEventListener(_event, receive) { this.receive = receive; }
    emit(frame) { this.receive({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); }
    close() { sources.delete(this); }
  }
  const lockService = { request(key, options, callback) {
    const previous = locks.get(key) || Promise.resolve();
    const job = previous.then(() => {
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return callback();
    });
    locks.set(key, job.catch(() => {}));
    return job;
  } };
  function tab(base = 'https://dsh.test/', unsupported = false) {
    const events = [], warnings = [], errors = [];
    let plugin, dispose;
    vm.runInNewContext(code, {
      URL, AbortController, document: { baseURI: base },
      navigator: unsupported ? {} : { locks: lockService },
      BroadcastChannel: Channel, EventSource: Source,
      window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(); } } },
    });
    plugin.apply({
      modules: { entries: {
        reload: async (id, rev) => { events.push(['reload', id, rev]); },
        sync: async graph => { events.push(['sync', JSON.stringify(graph)]); },
      } },
      logger: { warn: text => warnings.push(text), error: error => errors.push(error) },
      effect: fn => { dispose = fn(); },
    });
    return { events, warnings, errors, dispose: () => dispose() };
  }
  return { tab, sources, channels };
}

test('current DSH uses one connection and forwards graph and rebuilds to every entry controller', async () => {
  const w = world(), tabs = Array.from({ length: 12 }, () => w.tab());
  await settle();
  assert.equal(w.sources.size, 1);
  const source = [...w.sources][0];
  source.emit({ type: 'graph', graph: { plugins: [] } });
  await settle();
  source.emit({ type: 'rebuilt', id: 'plugin', rev: 'one' });
  source.emit({ type: 'rebuilt', id: 'plugin', rev: 'two' });
  await settle();
  for (const tab of tabs) {
    assert.deepEqual(tab.events, [['sync', '{"plugins":[]}'], ['reload', 'plugin', 'one'], ['reload', 'plugin', 'two']]);
    assert.equal(tab.errors.length, 0);
  }
  tabs[0].dispose();
  await settle();
  assert.equal(w.sources.size, 1);
  assert.notEqual([...w.sources][0], source);
  tabs.slice(1).forEach(tab => tab.dispose());
  await settle();
  assert.equal(w.sources.size, 0);
  assert.equal(w.channels.size, 0);
});

test('document-relative mounts have separate locks, channels, and event URLs', async () => {
  const w = world(), a = w.tab('https://dsh.test/one/'), b = w.tab('https://dsh.test/two/');
  await settle();
  assert.deepEqual([...w.sources].map(source => source.url).sort(), ['https://dsh.test/one/plugins/events', 'https://dsh.test/two/plugins/events']);
  [...w.sources].find(source => source.url.includes('/one/')).emit({ type: 'rebuilt', id: 'a', rev: 'one' });
  await settle();
  assert.equal(a.events.length, 1);
  assert.equal(b.events.length, 0);
  a.dispose(); b.dispose(); await settle();
  assert.equal(w.sources.size, 0);
});

test('current controller rejects malformed frames on followers and skips unsupported browsers', async () => {
  const w = world(), a = w.tab(), b = w.tab(), unsupported = w.tab('https://dsh.test/', true);
  await settle();
  [...w.sources][0].emit('invalid json');
  [...w.sources][0].emit({ type: 'rebuilt', id: 1 });
  await settle();
  for (const tab of [a, b]) { assert.equal(tab.warnings.length, 2); assert.equal(tab.events.length, 0); tab.dispose(); }
  assert.equal(unsupported.warnings.length, 1);
  unsupported.dispose(); await settle();
  assert.equal(w.sources.size, 0);
});
