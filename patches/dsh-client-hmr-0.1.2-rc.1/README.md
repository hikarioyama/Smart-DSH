# Shared HMR connection for DSH 0.1.2-rc.1

This is a narrowly versioned workaround for **upstream DSH's `client-hmr`**, not a
change to Smart-DSH's `dsh-notify-push` notifications. Smart-DSH remains a plugin
bundle, not a DSH fork.

## Problem

The upstream browser plugin opens one long-lived HTTP/1.1 EventSource connection
to `/plugins/events` per tab, even when no developer is rebuilding plugins.
Firefox normally allows six persistent HTTP/1.1 connections to one server.
Enough DSH tabs can consume those slots, queuing RPC requests and new WebSocket
handshakes. A fresh tab then shows **“No sessions yet”** and no workspaces although
the server still has the session data and older WebSocket connections work.

This workaround shares **one** EventSource among same-origin tabs using
`BroadcastChannel` and `navigator.locks`. The owning tab relays HMR frames to its
peers. Closing the owner or disposing its HMR plugin releases the lock and lets a
waiting tab take over. Frame validation and ordinary plugin hot reload remain in
place. Different origins/browser storage partitions elect separate owners.

Browsers without BroadcastChannel or Web Locks skip only optional developer HMR;
normal sessions and notifications are not disabled. Web Locks require a secure
context, including `http://localhost`, loopback HTTP, or HTTPS. A DSH page on plain
remote-IP HTTP may therefore need a manual refresh after a plugin rebuild.

## Apply safely

From the Smart-DSH checkout, with the intended `dsh` launcher on `PATH`:

```bash
# Read-only; prints the resolved target and whether it is original or patched.
node scripts/apply-shared-hmr.cjs --check

# Explicit write: verify version + SHA-256, back up, then replace client.js atomically.
node scripts/apply-shared-hmr.cjs --apply
```

For a wrapper or nonstandard installation, pass the installed **HMR package**
directory explicitly (not the Smart-DSH directory):

```bash
node scripts/apply-shared-hmr.cjs --check \
  --package-dir /path/to/node_modules/@deepseek-ai/dsh-client-hmr
node scripts/apply-shared-hmr.cjs --apply \
  --package-dir /path/to/node_modules/@deepseek-ai/dsh-client-hmr
```

The script never launches or restarts DSH, changes browser preferences, or edits
session storage, authentication, or notification configuration. Applying an
already-installed fix is a no-op. Unknown versions or locally edited bundles are
rejected. Backups default to `$XDG_STATE_HOME/Smart-DSH/backups` (or
`~/.local/state/Smart-DSH/backups`) with mode `0600`; `--backup-dir` can override it.
Keep the path printed by `--apply` for rollback:

```bash
node scripts/apply-shared-hmr.cjs --restore /path/to/printed-backup.js
```

Restoration requires both a recognized patched target and the exact supported
upstream backup (an already-restored target is a no-op). It reintroduces the
per-tab connection limit. A DSH reinstall/upgrade can replace the workaround;
re-run `--check`, and do not force it onto an unverified version.

DSH's existing HMR watcher can hot-update this client file without restarting the
server. If every HTTP slot is already occupied, the update's own download can
also be queued. Close an **unused** DSH tab when safe, or wait for a slot to free;
do not kill active sessions. An already-disconnected page may need a normal
refresh after the shared stream is active. Verify a fresh tab displays the
existing workspaces and sessions. This fix does not change the empty-state UI's
error reporting.

## Tests and provenance

```bash
node --test scripts/test-shared-hmr.cjs scripts/test-apply-shared-hmr.cjs
```

The tests need only Node and isolated temporary fixtures, not a live DSH server.
They cover 12 simulated tabs sharing one stream, ordered frame delivery,
leadership handoff, cancellation/disposal, invalid frames, unsupported browsers,
read-only checks, idempotent installation, backups/rollback, version guards, and
preservation of local/concurrent edits.

The replacement was also checked on a running DSH `0.1.2-rc.1` instance: its
existing HMR watcher served the changed artifact and a newly opened Firefox tab
showed the saved workspace/session list without a server restart.

- `client.js`: the verified replacement browser bundle.
- `upstream-client.js`: the unchanged upstream bundle, used only as a test fixture.
- `LICENSE`: upstream MIT license, covering the derived client code.
- Upstream source: [DeepSeek Harness, `packages/client/hmr`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/hmr).
