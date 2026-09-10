const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { run, parseArgs, hash, ORIGINAL_HASH, PATCHED_HASH } = require('./apply-shared-hmr.cjs');
const patchDir = path.join(__dirname, '../patches/dsh-client-hmr-0.1.2-rc.1');
const upstream = fs.readFileSync(path.join(patchDir, 'upstream-client.js'));
const patched = fs.readFileSync(path.join(patchDir, 'client.js'));
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-dsh-hmr-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageDir = path.join(root, 'package'), backupDir = path.join(root, 'backups');
  fs.mkdirSync(path.join(packageDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-client-hmr', version: '0.1.2-rc.1', ...overrides,
  }));
  const target = path.join(packageDir, 'lib/client.js');
  fs.writeFileSync(target, upstream);
  return { root, packageDir, backupDir, target };
}
test('vendored upstream and replacement match the verified integrity hashes', () => {
  assert.equal(hash(upstream), ORIGINAL_HASH); assert.equal(hash(patched), PATCHED_HASH);
});
test('CLI defaults to a read-only check without creating backups', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'apply-shared-hmr.cjs'), '--package-dir', f.packageDir, '--backup-dir', f.backupDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, 'original');
  assert.equal(fs.existsSync(f.backupDir), false); assert.deepEqual(fs.readFileSync(f.target), upstream);
});
test('apply creates a private backup, is idempotent, and restores original bytes', t => {
  const f = fixture(t);
  const result = run({ ...f, mode: 'apply' });
  assert.equal(result.changed, true); assert.equal(result.state, 'patched');
  assert.deepEqual(fs.readFileSync(f.target), patched); assert.deepEqual(fs.readFileSync(result.backup), upstream);
  if (process.platform !== 'win32') assert.equal(fs.statSync(result.backup).mode & 0o777, 0o600);
  assert.equal(run({ ...f, mode: 'apply' }).changed, false); assert.equal(fs.readdirSync(f.backupDir).length, 1);
  assert.equal(run({ ...f, mode: 'check' }).state, 'patched');
  assert.equal(run({ ...f, mode: 'restore', restoreFile: result.backup }).changed, true);
  assert.deepEqual(fs.readFileSync(f.target), upstream);
  assert.equal(run({ ...f, mode: 'restore', restoreFile: result.backup }).changed, false);
});
test('unsupported versions and package names fail without touching files', t => {
  for (const overrides of [{ version: '0.2.0' }, { name: 'unrelated-package' }]) {
    const f = fixture(t, overrides);
    assert.throws(() => run({ ...f, mode: 'apply' }), /Only .* is supported/);
    assert.deepEqual(fs.readFileSync(f.target), upstream); assert.equal(fs.existsSync(f.backupDir), false);
  }
});
test('unknown local edits are preserved, not silently overwritten', t => {
  const f = fixture(t); const custom = Buffer.concat([upstream, Buffer.from('\n// unrelated local work\n')]);
  fs.writeFileSync(f.target, custom);
  assert.throws(() => run({ ...f, mode: 'apply' }), /unrecognized changes/);
  assert.deepEqual(fs.readFileSync(f.target), custom); assert.equal(fs.existsSync(f.backupDir), false);
});
test('restore rejects an unrelated backup and preserves the installed fix', t => {
  const f = fixture(t); run({ ...f, mode: 'apply' });
  const invalid = path.join(f.root, 'not-a-backup.js'); fs.writeFileSync(invalid, 'unrelated');
  assert.throws(() => run({ ...f, mode: 'restore', restoreFile: invalid }), /Backup does not match/);
  assert.deepEqual(fs.readFileSync(f.target), patched);
});
test('a concurrent target change is preserved and temporary files are cleaned', t => {
  const f = fixture(t); const custom = Buffer.from('// concurrently edited\n');
  const originalSync = fs.fsyncSync;
  fs.fsyncSync = fd => { originalSync(fd); fs.writeFileSync(f.target, custom); };
  try { assert.throws(() => run({ ...f, mode: 'apply' }), /changed during installation/); }
  finally { fs.fsyncSync = originalSync; }
  assert.deepEqual(fs.readFileSync(f.target), custom);
  assert.deepEqual(fs.readdirSync(path.dirname(f.target)), ['client.js']);
});
test('CLI rejects ambiguous or malformed operations', () => {
  assert.deepEqual(parseArgs([]), { mode: 'check' });
  assert.throws(() => parseArgs(['--apply', '--check']), /Choose only one/);
  assert.throws(() => parseArgs(['--restore']), /requires a value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});
