# Smart-DSH — Mobile UI and notifications for DeepSeek Harness

An unofficial **DSH plugin bundle and Linux setup guide**, not a fork of DSH.
Keep upstream DSH installed; add Smart-DSH for:

- **Mobile UI:** full-width chat and composer, logo-toggled icon rail, no logo tooltip or tap tint.
- **Notifications:** questions and top-level turn-end notifications through Web Push.
- **Remote access guide:** connect a phone using tailnet-only Tailscale Serve HTTPS.
- **Multi-tab reliability:** an optional, guarded [shared-HMR workaround](patches/dsh-client-hmr-0.1.2-rc.1/README.md) prevents upstream developer-update connections from exhausting Firefox's HTTP/1.1 connection slots.

This is an unofficial community extension; it is not affiliated with DeepSeek.
Compatibility is tested against DSH `0.1.2-rc.1`; mobile styles use version-specific
selectors. Turn-end notifications describe agent turn termination, not independent
verification that every requested task succeeded.

A self-contained [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)
bundle (`dsh-notify-push`) plus setup notes for the paired remote-access infrastructure
(Tailscale Serve + phone). When the agent calls `ask_user_question`, your phone receives
a Web Push notification with the question text — **even when no browser is connected**.
When a turn ends, you get a completion notification whose title reflects the end reason
(`作業完了` / token-cap truncation / blocked / error / aborted); subagent turns do not
notify — only top-level sessions. Tapping a notification focuses the app.

> Status: working setup on Arch Linux, verified 2026-09-07 with real deliveries to
> Android Chrome and desktop Firefox. Host-specific identifiers are omitted from these setup examples.

## Requirements

| Requirement | Why |
|---|---|
| DSH `0.1.2-rc.1` | The bundle relies on `webServer.register`, `connection.requestRejection`, and the `{ prepend: true }` listener option — verify these exist if your DSH differs (`dsh --version`) |
| Node `>= 22.19` (23 excluded) | DSH's own requirement |
| `pnpm` | `dsh plugin` is a thin pnpm forwarder |
| Any Chromium-based browser or Firefox with `PushManager` | Verified on Android Chrome (FCM) and desktop Firefox (Mozilla autopush) |
| A **secure context** for the phone | HTTPS via Tailscale Serve (below) — plain `http://<ip>:3080` cannot subscribe to push |
| Android: nothing extra. iOS: Add-to-Home-Screen | iOS WebKit only delivers push to installed PWAs (16.4+) |

## How it works

```
ask_user_question (tool)
  └─ host: ctx.on("user-questions/request", listener, { prepend: true })   ← outermost
       ├─ sendPushToAll()        web-push → FCM / Mozilla autopush (fire-and-forget)
       └─ return next()          delegates to api-remotes forwarder → browser composer
                                 (the waterfall is NEVER consumed)

turn completion (top-level sessions only)
  └─ host: ctx.inject(["agents"]) → agentCtx.on("session/event", listener)
       ├─ filter: agents.roots().includes(agents.get(session.id))   ← subagent turns excluded
       └─ sendPushToAll(buildTurnEndPayload(session.id, event.data.reason))
                                 titles by reason.kind: completed / max-tokens / blocked / error / aborted
```

| Component | File | Role |
|---|---|---|
| Host half | `dsh-notify-push/lib/index.js` | prepended `user-questions/request` waterfall listener + `session/event` (`turn/end`) listener (root sessions only) + Web Push fan-out + HTTP routes (`/api/push/*` authed via `connection.requestRejection`, `/push/sw.js` static with `Service-Worker-Allowed: /`) |
| Client half | `dsh-notify-push/lib/client.js` | `window.__ModuleLoader__.load({...})` wrapper; local `Notification` while the page is alive; `/notify` popupSelect command for permission + push subscribe/unsubscribe |
| Service worker | `dsh-notify-push/sw/sw.js` | `push` → `showNotification` (`requireInteraction: true`), `notificationclick` → focus/open window |
| State | `$DSH_HOME/notify-push/` (0600, **not in this repo**) | `vapid.json` (generated on first start, must persist across restarts) + `subscriptions.json` (auto-pruned on 404/410) |

The state directory follows `DSH_HOME` (default `~/.dsh`), so nothing here is
hard-wired to a specific user.

## Install

```bash
# 0. Where to keep the bundle source — any persistent path works; ~/.dsh/profiles/web/bundles-src/
#    is just what this setup uses. Adjust BUNDLE_SRC freely.
BUNDLE_SRC="$HOME/.dsh/profiles/web/bundles-src/dsh-notify-push"
git clone https://github.com/hikarioyama/Smart-DSH.git /tmp/Smart-DSH
mkdir -p "$(dirname "$BUNDLE_SRC")"
cp -r /tmp/Smart-DSH/dsh-notify-push "$BUNDLE_SRC"

# 1. The bundle's own dependency ("web-push"). Order relative to step 2 does not matter,
#    but run this BEFORE the first restart.
cd "$BUNDLE_SRC" && pnpm add web-push@^3.6.7

# 2. Register into the web profile (adds the dependency as link: AND appends
#    dsh-notify-push to dsh.profile.bundles via its dsh.bundle.patch declaration)
cd ~/.dsh/profiles/web && dsh plugin --profile web add "$BUNDLE_SRC"

# 3. Verify composition read-only (never touches a running server)
dsh --profile web --dump-config | grep dsh-notify-push   # expect: "- id: dsh-notify-push"

# 4. Verify the dependency resolves (from the profile dir)
cd ~/.dsh/profiles/web && node --input-type=module -e "await import('web-push'); console.log('web-push resolvable')"
```

> **Dependency note**: `dsh` profiles use `nodeLinker: hoisted` in their
> `pnpm-workspace.yaml`, so the `pnpm add` in step 1 lands inside the profile's
> `node_modules` and resolves from the linked bundle. If step 4 reports that
> `web-push` can't be resolved, re-run step 1 and then `pnpm install` in the
> profile dir.

Then restart and enable:

```bash
systemctl --user restart dsh-web.service
# In the DSH UI on each device: /notify → ON → grant the notification permission.
```

Expected result: `~/.dsh/notify-push/vapid.json` + `subscriptions.json` appear on first
start; each enabled device appears as one subscription; asking the agent a question that
triggers `ask_user_question` produces a notification on every enabled device.

## Fresh tabs show “No sessions yet”

On DSH `0.1.2-rc.1`, upstream `client-hmr` opens a permanent developer-update
connection for each tab. Enough tabs can exhaust a browser's HTTP/1.1 slots,
preventing fresh session-list requests and WebSocket handshakes. This is unrelated
to the `dsh-notify-push` notification plugin and does not mean sessions were deleted.

Smart-DSH includes a version- and checksum-guarded workaround that shares one HMR
connection across tabs. From this checkout:

```bash
node scripts/apply-shared-hmr.cjs --check  # read-only; resolves the dsh on PATH
node scripts/apply-shared-hmr.cjs --apply  # explicit write with a private backup
node --test scripts/test-shared-hmr.cjs scripts/test-apply-shared-hmr.cjs
```

It does not restart DSH or alter browser preferences/session data. Unknown versions
or existing local edits are rejected. This is a separate, optional install step;
copying only `dsh-notify-push` does not apply it. See the
[workaround guide](patches/dsh-client-hmr-0.1.2-rc.1/README.md) for explicit paths,
rollback, browser requirements, live-update limitations, and rechecking after DSH
upgrades.

## Paired infrastructure (remote access + phone)

Minimal, reproducible form — the `flock`/guard/URL-file plumbing in the author's setup
is machine-specific and intentionally **not** part of this repo:

```ini
# ~/.config/systemd/user/dsh-web.service (minimal working form)
# Adjust the ExecStart path to your dsh install location (`which dsh`).
[Unit]
Description=DSH web server
After=network.target

[Service]
Environment="DSH_HOME=%h/.dsh"
ExecStart=%h/.local/bin/dsh web --host 127.0.0.1 --port 3080 \
  --trusted-host <machine>.<tailnet>.ts.net --no-open
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
# Expose to the tailnet only (current tailscale CLI syntax; run once, persists):
tailscale serve --bg 3080
# → https://<machine>.<tailnet>.ts.net (proxying http://127.0.0.1:3080)
tailscale serve status   # verify
```

Notes learned during setup:

- DSH binds loopback only; Tailscale Serve is the sole external exposure, so the
  unauthenticated `/push/sw.js` route is reachable from tailnet devices only.
- The `--trusted-host` value must match the hostname your phone uses, or the browser-trust
  fence will reject the connection.
- The web app already ships a PWA manifest, so the notification-click focus path works
  from a home-screen install too.
- If you also run a guard against duplicate DSH launchers, do **not** boot a second
  throwaway instance for testing — see "Testing without a live server".
- `tailscale serve` syntax differs across versions (`serve --bg 3080` on current CLI,
  `serve https / http://...` on older ones) — check `tailscale serve --help`.

## Testing without a live server

A self-contained `node --test` suite ships with the bundle (writes only to a temp
`DSH_HOME`, touches no real state):

```bash
cd dsh-notify-push && pnpm install && npm test
# expect: pass 1 / fail 0
```

What it covers:

- Host half with a fake `ctx` (`ctx.on/effect/inject` + `webServer.register` collector +
  `Readable.from` request bodies): route registration, auth 401/403 on `/api/push/*`,
  subscription validation + persistence, waterfall delegation (`next()` value passes
  through), and the `Service-Worker-Allowed: /` header on `/push/sw.js`.
- The push send path is exercised with a real ECDH P-256 subscription: encryption + VAPID
  signing succeed and the send fails at DNS (`ENOTFOUND` against an invalid endpoint),
  which proves the pipeline up to the network.
- The client half is not covered by an automated test: verify it manually by loading
  `lib/client.js` with a `window.__ModuleLoader__` shim and a stub `ctx` (assert the
  `user-questions/request` listener passes `next()`'s value through, and that the
  `/notify` popupSelect contribution registers).

## Ops

- Toggle: `/notify` ON/OFF per device. Revoking browser permission → auto re-subscribe
  fails at the next startup and the stored toggle drops to OFF.
- Restart checklist: DSH sessions survive via the append-only log; verify
  `$DSH_HOME/notify-push/vapid.json` still exists after restart (fresh keys would orphan
  every subscription — delete `subscriptions.json` too if you intentionally reset keys).
- Not receiving notifications, in order: (1) `vapid.json` survived the restart, (2) no
  `notify-push` errors in the server log, (3) the site's notification permission is
  "Allow" and Chrome's system-level notifications are on, (4) `subscriptions.json` still
  has entries.
- This bundle follows the `dsh.bundle.patch` + `dsh.client` three-layer plugin pattern;
  see `dsh-notify-push/cordis.patch.yml` and `package.json` for the minimal declarations.

## Customization pointers

- **Language**: the notification title/body prefix and the `/notify` command copy are
  Japanese by default (`選択肢`, `（他 N 件）`, `通知: ON`). Edit `buildPayload` in
  `lib/index.js`, `questionSummary`/`statusLabel`/command labels in `lib/client.js`.
- **VAPID subject**: `mailto:root@localhost` in `configure()` is a placeholder; some push
  services warn about it — set your own contact address.
- **Browser support**: any browser exposing `PushManager` passes the `/notify` availability
  check; only Android Chrome and desktop Firefox have been verified.
- The `requireInteraction: true` in `sw/sw.js` keeps the notification on screen; lower it
  if you prefer transient banners.

## KG node

The knowledge-graph node mirroring this repo:
`~/knowledge/nodes/agents/dsh-notify-push-bundle-pattern.md`.

## Mobile layout (DSH 0.1.2-rc.1)

At viewport widths up to 767 CSS pixels, the collapsed sidebar occupies only the
logo corner; the chat column uses the full viewport width. Tap the DeepSeek logo
to show the original icon rail; tap again to hide it. Desktop layout is unchanged.
Upstream expanded sidebar panels retain their normal behavior. CSS-module selectors
are version-specific: recheck after a DSH upgrade. No notification logic is changed.

Browser regression check against an existing DSH server (does not start/restart DSH):
`PLAYWRIGHT_MODULE=/path/to/playwright DSH_LOGIN_URL_FILE=/path/to/private-login-url.txt node scripts/test-mobile-layout.cjs`.
Uses isolated browser contexts, verifies 360/412/767/768/1280 CSS-pixel widths, toggle
round trips and cleanup. The login URL file must be private; never commit it.
