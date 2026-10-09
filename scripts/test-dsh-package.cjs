const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDshPackage, resolvePackageFrom } = require('./dsh-package.cjs');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-dsh-resolve-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  const root = path.join(home, 'runtime/node_modules/@deepseek-ai/dsh');
  const dependency = path.join(home, 'runtime/node_modules/@deepseek-ai/dsh-client-hmr');
  for (const [dir, name] of [[root, '@deepseek-ai/dsh'], [dependency, '@deepseek-ai/dsh-client-hmr']]) {
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.2.0-rc.2', exports: { './package.json': './package.json' } }));
    fs.writeFileSync(path.join(dir, 'lib/bin.js'), 'throw new Error("must not execute launcher")');
  }
  const cli = path.join(root, 'lib/bin.js');
  const env = { HOME: home, PATH: bin };
  return { home, bin, root, dependency, cli, env };
}

test('resolves original dsh and its hoisted packages from a PATH symlink', t => {
  const f = fixture(t);
  fs.symlinkSync(f.cli, path.join(f.bin, 'dsh'));
  assert.equal(resolveDshPackage('@deepseek-ai/dsh', f), f.root);
  assert.equal(resolveDshPackage('@deepseek-ai/dsh-client-hmr', f), f.dependency);
});

test('rdsh shadowing dsh uses the original sibling without running either binary', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.bin, 'dsh'), 'not a Node launcher');
  fs.symlinkSync(f.cli, path.join(f.bin, 'dsh-orig'));
  assert.equal(resolveDshPackage('@deepseek-ai/dsh-client-hmr', f), f.dependency);
});

test('recorded rdsh origin and both original-binary overrides locate DSH', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.home, '.config/rdsh'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.config/rdsh/origin'), f.cli + '\n');
  assert.equal(resolveDshPackage('@deepseek-ai/dsh', f), f.root);
  for (const key of ['RDSH_ORIG_BIN', 'DSH_ORIG_BIN']) {
    assert.equal(resolveDshPackage('@deepseek-ai/dsh', { env: { ...f.env, [key]: f.cli } }), f.root);
  }
});

test('explicit directories accept DSH roots and individual target packages', t => {
  const f = fixture(t);
  for (const key of ['DSH_PACKAGE_DIR', 'DSH_ROOT']) {
    assert.equal(resolveDshPackage('@deepseek-ai/dsh-client-hmr', { env: { ...f.env, [key]: f.root } }), f.dependency);
    assert.equal(resolveDshPackage('@deepseek-ai/dsh-client-hmr', { env: { ...f.env, [key]: f.dependency } }), f.dependency);
  }
  assert.equal(resolveDshPackage('@deepseek-ai/dsh-client-hmr', { ...f, packageDir: f.dependency }), f.dependency);
});

test('a broken explicit override fails instead of silently selecting another install', t => {
  const f = fixture(t);
  fs.symlinkSync(f.cli, path.join(f.bin, 'dsh'));
  assert.throws(() => resolveDshPackage('@deepseek-ai/dsh', { env: { ...f.env, RDSH_ORIG_BIN: path.join(f.home, 'missing') } }), /ENOENT/);
});

test('broken links and a Rust shim are skipped to find the next Node installation', t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(f.home, 'missing'), path.join(f.bin, 'dsh-orig'));
  fs.writeFileSync(path.join(f.bin, 'dsh'), 'Rust binary');
  const next = path.join(f.home, 'next');
  fs.mkdirSync(next);
  fs.symlinkSync(f.cli, path.join(next, 'dsh'));
  assert.equal(resolveDshPackage('@deepseek-ai/dsh', { env: { ...f.env, PATH: f.bin + path.delimiter + next } }), f.root);
});

test('dependencies with private package manifests resolve from their owning package', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dependency, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-hmr', exports: { '.': './lib/bin.js' } }));
  assert.equal(resolvePackageFrom('@deepseek-ai/dsh-client-hmr', path.join(f.root, 'package.json')), f.dependency);
});

test('missing installations explain the rdsh-compatible overrides', t => {
  const f = fixture(t);
  assert.throws(() => resolveDshPackage('@deepseek-ai/dsh', f), /DSH_PACKAGE_DIR.*RDSH_ORIG_BIN/);
});
