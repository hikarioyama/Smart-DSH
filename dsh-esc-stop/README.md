# dsh-esc-stop

Press **Escape** while the agent is thinking and the running turn is cancelled —
the same cancellation the composer's **停止生成** button performs. A settings row
turns the gesture on and off; it is ON by default.

Self-contained [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)
bundle, dual-face like `dsh-notify-push`: the host half registers one settings
namespace, the browser half installs the listener and the settings row.

> Status: verified against DSH `0.1.2-rc.1` (unit suite + a browser regression
> check against a live DSH server).

## What counts as "stop the inference"

`decideEscapeStop()` judges every `keydown` and refuses unless all of these hold,
so nothing is cancelled that the user did not aim at:

| Guard | Why |
|---|---|
| `key === "Escape"`, no `Ctrl`/`Meta`/`Alt`/`Shift` | Modifier chords belong to the browser or OS |
| not a key repeat | Holding Escape must not fire repeatedly |
| not composing (IME) | The input method owns the key |
| `event.defaultPrevented === false` | A handler that already consumed Escape wins |
| the event target is not a native `input`/`textarea`/`select` | The queue-message editor closes itself on Escape |
| no `[aria-modal="true"]` element is open | The Settings panel owns Escape while it is open |
| no `[role="listbox"]`/`[role="menu"]` element is open | The command menu, a popupSelect, and pickers own Escape |
| the durable toggle is ON | The settings row |
| one viewed session exists and reports `running` | Nothing to stop otherwise |
| not removed and not a subagent view | Mirrors the composer's own stop affordance |

The listener sits on `document` in the **capture** phase and defers its judgement by
one microtask. Capture is earlier than the composer keymap on the editor root, so
inside capture the key's fate is not yet decided; one microtask later a nearer
handler has either consumed it (`defaultPrevented`) or closed its overlay, and
both facts are readable exactly once. Reading them any earlier would let Escape
close a menu *and* stop the turn.

The accepted path is the composer's own: the session-scoped `conversation`
service (`sessions.scope(id).get("conversation").cancel()`), with
`session.cancel()` as the fallback. Failures are logged and the session
snapshot's `promptError` carries the user-visible part, exactly as for the
button.

## Toggle

Settings → **General** → *Esc で推論を停止* (ON/OFF). The value is the host
setting `esc-stop.enabled` in the user settings document
(`$DSH_HOME/settings.yaml`), so it follows the account across devices and needs
no file editing or restart. While the namespace is unavailable the row defaults
to ON and its switch stays disabled.

## Files

| Component | File | Role |
|---|---|---|
| Host half | `lib/index.js` | Registers the `esc-stop` settings namespace (one boolean, default `true`) |
| Client half | `lib/client.js` | `decideEscapeStop` + the document `keydown` listener, and the General-settings row |
| Composition | `cordis.patch.yml` | Inserts the bundle into the profile |
| Unit tests | `tests/*.test.mjs` | Host registration and the whole client decision/listener/row surface |

Everything it needs beyond the built-in client modules
(`react/jsx-runtime`, `@deepseek-ai/dsh-client-store`) is a service injected from
an already-composed plugin: `sessions`, `slots`, `settingsScope`.

## Install

```bash
# 0. Where to keep the bundle source — any persistent path works; this setup uses
#    ~/.dsh/profiles/web/bundles-src/. Adjust BUNDLE_SRC freely.
BUNDLE_SRC="$HOME/.dsh/profiles/web/bundles-src/dsh-esc-stop"
git clone https://github.com/hikarioyama/Smart-DSH.git /tmp/Smart-DSH
mkdir -p "$(dirname "$BUNDLE_SRC")"
cp -r /tmp/Smart-DSH/dsh-esc-stop "$BUNDLE_SRC"

# 1. Register into the web profile (adds the dependency as link: AND appends
#    dsh-esc-stop to dsh.profile.bundles via its dsh.bundle.patch declaration)
cd ~/.dsh/profiles/web && dsh plugin --profile web add "$BUNDLE_SRC"

# 2. Verify composition read-only (never touches a running server)
dsh --profile web --dump-config | grep dsh-esc-stop   # expect: "- id: dsh-esc-stop"

# 3. Restart so the profile boots the new bundle
systemctl --user restart dsh-web.service
```

> Restarting `dsh-web.service` interrupts the session running that command. Run
> it from a terminal that is not hosting the agent you are talking to.

The bundle has no runtime dependency of its own (`@deepseek-ai/schemastery` is
provided by the host composition), so step 1 needs no extra `pnpm add`, unlike
`dsh-notify-push`.

## Testing

Unit suite (no DSH process, no network):

```bash
cd dsh-esc-stop && npm install && npm test
# expect: tests 14 / pass 14 / fail 0
```

Browser regression check against an **already-running** DSH server. It injects
the shipped listener into a live page and drives real `KeyboardEvent`s against
stub sessions, so no real turn is cancelled and no DSH process is started or
restarted:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright \
DSH_LOGIN_URL_FILE=/path/to/private-login-url.txt \
node scripts/test-esc-stop.cjs
```

It verifies the composed provider bundles exist, all twelve in-page gestures
(stop, idle, toggle off, repeat, modifiers, modal, list overlay, native input,
consumed key, repeat press, disposal, named refusal reason) and that the whole
shipped bundle parses and registers with the live `__ModuleLoader__`. The login
URL file is private input and is never printed.

## Notes and limitations

- One document-level listener in the capture phase; no upstream file is patched.
  A DSH upgrade that changes the composer's Escape arbitration only changes what
  is pre-consumed or which overlay element wraps the open menu, and both are read
  from the event and the DOM rather than from any internal API.
- Stop cancels the in-flight turn only; pending queued messages stay and resume
  in FIFO order, as with the button.
- A turn is stopped **only** in the session currently on stage. Pressing Escape
  while viewing a different session (or a subagent) does nothing.
- `esc-stop.enabled` lives in the user settings document, which is machine-local
  state and is never part of this repository.
