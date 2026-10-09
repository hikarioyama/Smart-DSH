'use strict';

const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');

function resolvePackageFrom(name, entry) {
  const requireFrom = createRequire(fs.realpathSync(entry));
  let manifest;
  try { manifest = requireFrom.resolve(`${name}/package.json`); }
  catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // Some dependencies export only their runtime entry, not package.json.
    manifest = requireFrom.resolve.paths(name).map(root => path.join(root, name, 'package.json')).find(file => fs.existsSync(file));
    if (!manifest) throw error;
  }
  const info = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (info.name !== name) throw new Error(`Expected ${name} at ${manifest}`);
  return path.dirname(fs.realpathSync(manifest));
}

/** Resolve installed Node packages without executing dsh (which may be rdsh). */
function resolveDshPackage(name, { packageDir, env = process.env } = {}) {
  function fromDirectory(directory) {
    const root = fs.realpathSync(directory);
    const manifest = path.join(root, 'package.json');
    if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return root;
    return resolvePackageFrom(name, manifest);
  }
  const explicit = packageDir || env.DSH_PACKAGE_DIR || env.DSH_ROOT;
  if (explicit) return fromDirectory(explicit);
  const original = env.RDSH_ORIG_BIN || env.DSH_ORIG_BIN;
  if (original) return resolvePackageFrom(name, original);

  const home = env.HOME || env.USERPROFILE || os.homedir();
  const candidates = [];
  try {
    const recorded = fs.readFileSync(path.join(home, '.config/rdsh/origin'), 'utf8').trim();
    if (recorded) candidates.push(recorded);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const directory of (env.PATH || '').split(path.delimiter)) {
    for (const cli of ['dsh-orig', 'dsh.orig', 'dsh.real', 'dsh', 'dsh-orig.cmd', 'dsh.cmd', 'dsh-orig.exe', 'dsh.exe']) {
      candidates.push(path.join(directory || '.', cli));
    }
  }
  for (const entry of candidates) {
    try { return resolvePackageFrom(name, entry); } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
  }
  throw new Error(`Cannot resolve ${name}; set DSH_PACKAGE_DIR to the original DSH package or RDSH_ORIG_BIN to its launcher.`);
}

module.exports = { resolveDshPackage, resolvePackageFrom };

if (require.main === module) {
  try { console.log(resolveDshPackage(process.argv[2] || '@deepseek-ai/dsh')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
