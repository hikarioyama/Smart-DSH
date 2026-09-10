#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');

const PACKAGE_NAME = '@deepseek-ai/dsh-client-hmr';
const VERSION = '0.1.2-rc.1';
const ORIGINAL_HASH = '39cf44a8202214eca333d8f8fdf98b3fd35933ee27d75c42b5e98e1db96a84e0';
const PATCHED_HASH = 'bd34b4ae19702e467ac3255b723df4a23c3b961ece608cb04dbf5cff538a4466';
const PATCH_FILE = path.join(__dirname, '../patches/dsh-client-hmr-0.1.2-rc.1/client.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function resolvePackageDir(explicit) {
  if (explicit) return fs.realpathSync(explicit);
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const cli = path.join(directory || '.', 'dsh');
    try {
      fs.accessSync(cli, fs.constants.X_OK);
      const entry = fs.realpathSync(cli);
      const manifest = createRequire(entry).resolve(`${PACKAGE_NAME}/package.json`);
      return path.dirname(manifest);
    } catch (error) {
      if (fs.existsSync(cli)) {
        throw new Error('Cannot resolve the HMR package from dsh on PATH; pass --package-dir explicitly.');
      }
    }
  }
  throw new Error('dsh was not found on PATH; pass --package-dir explicitly.');
}

function inspect(packageDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  if (manifest.name !== PACKAGE_NAME || manifest.version !== VERSION) {
    throw new Error(`Only ${PACKAGE_NAME}@${VERSION} is supported; no files were changed.`);
  }
  const target = path.join(packageDir, 'lib/client.js');
  if (!fs.lstatSync(target).isFile()) throw new Error('Refusing a non-regular client.js target.');
  const bytes = fs.readFileSync(target);
  const digest = hash(bytes);
  const state = digest === ORIGINAL_HASH ? 'original' : digest === PATCHED_HASH ? 'patched' : 'unknown';
  if (state === 'unknown') throw new Error('client.js has unrecognized changes; refusing to overwrite it.');
  return { target, bytes, digest, state };
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
    if (hash(original) !== ORIGINAL_HASH) throw new Error('Backup does not match the supported upstream bundle.');
    if (current.state === 'original') return { state: 'original', target: current.target, changed: false };
    atomicReplace(current.target, original, PATCHED_HASH);
    return { state: 'original', target: current.target, changed: true };
  }
  const patched = fs.readFileSync(PATCH_FILE);
  if (hash(patched) !== PATCHED_HASH) throw new Error('The bundled patch failed its integrity check.');
  if (current.state === 'patched') return { state: 'patched', target: current.target, changed: false };
  const backupDir = options.backupDir || path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'Smart-DSH/backups'
  );
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `hmr-${VERSION}-${Date.now()}-${randomBytes(6).toString('hex')}.js`);
  fs.writeFileSync(backup, current.bytes, { flag: 'wx', mode: 0o600 });
  atomicReplace(current.target, patched, ORIGINAL_HASH);
  return { state: 'patched', target: current.target, changed: true, backup };
}

const HELP = `Usage: node scripts/apply-shared-hmr.cjs [--check | --apply | --restore BACKUP]
       [--package-dir PATH] [--backup-dir PATH]

Default: --check (read-only). The target is resolved from dsh on PATH.
Only @deepseek-ai/dsh-client-hmr@0.1.2-rc.1 with recognized bundle bytes is accepted.
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
