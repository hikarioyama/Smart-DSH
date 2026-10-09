#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomBytes } = require('node:crypto');
const { resolveDshPackage } = require('./dsh-package.cjs');

const PACKAGE_NAME = '@deepseek-ai/dsh-client-hmr';
const VERSION = '0.1.2-rc.1';
const ORIGINAL_HASH = '39cf44a8202214eca333d8f8fdf98b3fd35933ee27d75c42b5e98e1db96a84e0';
const PATCHED_HASH = 'bd34b4ae19702e467ac3255b723df4a23c3b961ece608cb04dbf5cff538a4466';
const PATCH_FILE = path.join(__dirname, '../patches/dsh-client-hmr-0.1.2-rc.1/client.js');
const CURRENT = {
  originalHash: '0e312a088abf4ec4c176bb898d37621a2848a9c87a3db03fc99e6e9a6df9c4f3',
  patchedHash: '2315858064dc580117744c73a2bd1582c78f766080c9b365c5713c8d7f99abba',
  patchFile: path.join(__dirname, '../patches/dsh-client-hmr-0.2.0-rc.2/client.js'),
};
const RELEASES = {
  [VERSION]: { originalHash: ORIGINAL_HASH, patchedHash: PATCHED_HASH, patchFile: PATCH_FILE },
  '0.2.0-rc.2': CURRENT,
  '0.2.1-alpha.1': CURRENT,
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function resolvePackageDir(explicit) {
  if (explicit) return fs.realpathSync(explicit);
  return resolveDshPackage(PACKAGE_NAME, { packageDir: explicit });
}

function inspect(packageDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const release = Object.hasOwn(RELEASES, manifest.version) ? RELEASES[manifest.version] : undefined;
  if (manifest.name !== PACKAGE_NAME || !release) {
    throw new Error(`Only ${PACKAGE_NAME} versions ${Object.keys(RELEASES).join(', ')} are supported; no files were changed.`);
  }
  const target = path.join(packageDir, 'lib/client.js');
  if (!fs.lstatSync(target).isFile()) throw new Error('Refusing a non-regular client.js target.');
  const bytes = fs.readFileSync(target);
  const digest = hash(bytes);
  const state = digest === release.originalHash ? 'original' : digest === release.patchedHash ? 'patched' : 'unknown';
  if (state === 'unknown') throw new Error('client.js has unrecognized changes; refusing to overwrite it.');
  return { target, bytes, digest, state, release, version: manifest.version };
}

function atomicReplace(target, bytes, expectedHash) {
  const temporary = `${target}.smart-dsh-${randomBytes(8).toString('hex')}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(temporary, 'wx', fs.statSync(target).mode & 0o777);
    created = true;
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!fs.lstatSync(target).isFile() || hash(fs.readFileSync(target)) !== expectedHash) {
      throw new Error('client.js changed during installation; refusing to overwrite concurrent work.');
    }
    fs.renameSync(temporary, target);
    created = false;
  } finally {
    if (created) fs.unlinkSync(temporary);
  }
}

function run(options) {
  if (!['check', 'apply', 'restore'].includes(options.mode)) throw new Error('Unknown operation.');
  const packageDir = resolvePackageDir(options.packageDir);
  const current = inspect(packageDir);
  if (options.mode === 'check') return { state: current.state, target: current.target, changed: false };
  if (options.mode === 'restore') {
    if (!options.restoreFile) throw new Error('--restore requires a backup file.');
    const original = fs.readFileSync(options.restoreFile);
    if (hash(original) !== current.release.originalHash) throw new Error('Backup does not match the supported upstream bundle.');
    if (current.state === 'original') return { state: 'original', target: current.target, changed: false };
    atomicReplace(current.target, original, current.release.patchedHash);
    return { state: 'original', target: current.target, changed: true };
  }
  const patched = fs.readFileSync(current.release.patchFile);
  if (hash(patched) !== current.release.patchedHash) throw new Error('The bundled patch failed its integrity check.');
  if (current.state === 'patched') return { state: 'patched', target: current.target, changed: false };
  const backupDir = options.backupDir || path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'Smart-DSH/backups'
  );
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `hmr-${current.version}-${Date.now()}-${randomBytes(6).toString('hex')}.js`);
  fs.writeFileSync(backup, current.bytes, { flag: 'wx', mode: 0o600 });
  atomicReplace(current.target, patched, current.release.originalHash);
  return { state: 'patched', target: current.target, changed: true, backup };
}

const HELP = `Usage: node scripts/apply-shared-hmr.cjs [--check | --apply | --restore BACKUP]
       [--package-dir PATH] [--backup-dir PATH]

Default: --check (read-only). The target is resolved from dsh on PATH.
Only @deepseek-ai/dsh-client-hmr at ${Object.keys(RELEASES).join(', ')} with recognized bundle bytes is accepted.
No session data, Firefox preferences, notification plugins or server processes are touched.
--apply creates a private backup; --restore accepts only that upstream bundle.
DSH's existing HMR watcher may update browser clients when client.js is replaced.
`;

function parseArgs(argv) {
  const options = { mode: 'check' };
  let actionSeen = false;
  function value(i) {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} requires a value.`);
    return argv[i + 1];
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    if (['--check', '--apply', '--restore'].includes(arg)) {
      if (actionSeen) throw new Error('Choose only one of --check, --apply or --restore.');
      actionSeen = true;
      options.mode = arg.slice(2);
      if (arg === '--restore') options.restoreFile = value(i++);
    } else if (arg === '--package-dir') options.packageDir = value(i++);
    else if (arg === '--backup-dir') options.backupDir = value(i++);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else process.stdout.write(`${JSON.stringify(run(options), null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { run, parseArgs, hash, ORIGINAL_HASH, PATCHED_HASH };
