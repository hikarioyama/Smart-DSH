# DSH + Tailscale: Web Push notifications for `ask_user_question`

A self-contained [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle
(`dsh-notify-push`) plus the surrounding setup notes for the paired infrastructure:

- **DSH web server** on `127.0.0.1:3080` (systemd --user unit `dsh-web.service`)
- **Tailscale Serve** exposing it to the tailnet as `https://<machine>.<tailnet>.ts.net`
- **Web Push** to an Android phone's Chrome (FCM) and a desktop browser (Mozilla autopush)

When the agent calls `ask_user_question`, the phone receives a Web Push notification
with the question text — **even when no browser is connected**. Tapping the notification
focuses the app where the question composer is waiting.

> Status: working setup on Arch Linux, verified 2026-09-07 with real deliveries to
> Android Chrome and desktop Firefox. Host-specific identifiers are omitted from these setup examples.

## How it works

```
ask_user_question (tool)
  └─ host: ctx.on("user-questions/request", listener, { prepend: true })   ← outermost
       ├─ sendPushToAll()        web-push → FCM / Mozilla autopush (fire-and-forget)
       └─ return next()          delegates to api-remotes forwarder → browser composer
                                 (the waterfall is NEVER consumed)
```

| Component | File | Role |
|---|---|---|
| Host half | `dsh-notify-push/lib/index.js` | prepended waterfall listener + Web Push fan-out + HTTP routes (`/api/push/*` authed via `connection.requestRejection`, `/push/sw.js` static with `Service-Worker-Allowed: /`) |
| Client half | `dsh-notify-push/lib/client.js` | `window.__ModuleLoader__.load({...})` wrapper; local `Notification` while the page is alive; `/notify` popupSelect command for permission + push subscribe/unsubscribe |
| Service worker | `dsh-notify-push/sw/sw.js` | `push` → `showNotification` (`requireInteraction: true`), `notificationclick` → focus/open window |
| State | `~/.dsh/notify-push/` (0600, **not in this repo**) | `vapid.json` (generated on first start, must persist across restarts) + `subscriptions.json` (auto-pruned on 404/410) |

## Install

```bash
# 1. Source the bundle somewhere persistent
BUNDLE_SRC="$HOME/.dsh/profiles/web/bundles-src/dsh-notify-push"
git clone <this repo> /tmp/dsh-notify-push-tailscale
mkdir -p "$(dirname "$BUNDLE_SRC")"
cp -r /tmp/dsh-notify-push-tailscale/dsh-notify-push "$BUNDLE_SRC"

# 2. The bundle's own dependency (link: install does NOT install it)
cd "$BUNDLE_SRC" && pnpm add web-push@^3.6.7

# 3. Register into the web profile (auto-adds dsh.profile.bundles + link install)
cd ~/.dsh/profiles/web && dsh plugin --profile web add "$BUNDLE_SRC"

# 4. Verify composition read-only (never touches the running server)
dsh --profile web --dump-config | grep dsh-notify-push

# 5. Reflect: restart (in-flight turns die; sessions persist and resume;
#    unrelated processes like a local vLLM are unaffected)
systemctl --user restart dsh-web.service
```

Then in the DSH UI: run `/notify` → "ON" → grant the notification permission.
Repeat on every device you want notified (each device gets its own subscription).

## Paired infrastructure (the "Tailscale + phone" half)

`systemd --user` unit, no secrets in this repo:

```ini
# ~/.config/systemd/user/dsh-web.service (ExecStart excerpt)
ExecStart=/usr/bin/flock --nonblock --no-fork <lock> \
  <node> <dsh> web --host 127.0.0.1 --port 3080 \
  --trusted-host <machine>.<tailnet>.ts.net --no-open
```

```bash
# Expose to the tailnet only (not Funnel):
tailscale serve https / http://127.0.0.1:3080
# → https://<machine>.<tailnet>.ts.net  (tailnet only)
```

Notes learned during setup:

- DSH binds loopback only; Tailscale Serve is the sole external exposure, so the
  unauthenticated `/push/sw.js` route is reachable from tailnet devices only.
- Web Push requires a **secure context** — the `https://...ts.net` origin satisfies it
  (plain `http://<tailscale-ip>:3080` would not).
- The web app already ships a PWA manifest, so the notification-click focus path works
  from a home-screen install too.
- A guard script refuses a second DSH launcher (`guard-single-dsh.py`), so never run a
  second throwaway instance for testing — use the fake-ctx harness approach below.
- Android Chrome: SW + permission is enough. **iOS Chrome needs Add-to-Home-Screen.**

## Testing without a live server

Do **not** boot a second DSH (the single-instance guard fails closed). Instead:

- Host half: fake `ctx` harness (`ctx.on/effect/inject` + `webServer.register` collector +
  `Readable.from` for request bodies). Reaching a DNS failure (`ENOTFOUND`) with a real
  ECDH P-256 subscription proves the encrypt+VAPID pipeline.
- Client half: evaluate the served bundle shape with a `window.__ModuleLoader__` shim and
  a stub `ctx.remote.$on`; assert the listener returns `next()`'s value (delegation).

## Ops

- Toggle: `/notify` ON/OFF per device. Revoking browser permission → auto re-subscribe
  fails at next startup and the stored toggle drops to OFF.
- Restart checklist: the dsh-web session survives via the append-only log; verify
  `~/.dsh/notify-push/vapid.json` still exists after restart (fresh keys would orphan
  every subscription).
- This bundle follows the `dsh.bundle.patch` + `dsh.client` three-layer plugin pattern;
  see `dsh-notify-push/cordis.patch.yml` and `package.json` for the minimal declarations.

## KG node

The knowledge-graph node mirroring this repo: `~/knowledge/nodes/agents/dsh-notify-push-bundle-pattern.md`.
