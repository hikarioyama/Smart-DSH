# Maintenance boundaries and decisions

## Production path

- `core/audit-store.ts`: independent versioned audit persistence, no DSH imports.
- `core/thread-service.ts`: per-parent admission, idempotence, context references,
  audit-before-model and result persistence; injected model/context functions.
- `compat/host.ts`: authenticated exact routes (`dsh-btw/ask`, `dsh-btw/fork` only)
  and service composition.
- `compat/context.ts`: detached safe parent prefix and side history projection.
- `compat/model-call.ts`: public prepared call, exact stream accumulation; no private
  adapter inspection or automatic retries.
- `compat/fork.ts`: public SessionController.fork, Session.append, scoped flush. The
  real recorded assistant stream is validated in a detached Session before creating a
  child. Creation and completion are audited; interrupted fork retries are refused
  rather than blindly creating duplicates.
- `client/controller.ts`: pure observable state over an injected transport.
- `client/compat/`: revision-checked input claiming and composer-column layout.
  The claim is deliberately timid. It fires only while the draft is the bare
  `/btw ` token and the editor is not composing: `beginCommand` rewrites the
  leading span and parks the caret at the token, so running it while an IME owns
  the composition (or after the user has typed past the token) coloured the
  composing text with the command-token warn style and pulled the caret back on
  conversion. On DSH 0.1.5-rc.2 a claim is released when the separator space is
  deleted; the plugin does not fight that release — Enter still adjudicates
  `/btw <question>` through the trigger source.
- `client/ui/`: React/props, local pointer capture, no document-wide key/click hijacking.
- `client/index.tsx`: DSH service/slot registration and opening the created fork.

## Where the panel is allowed to depend on DSH

The panel is deliberately a second DSH composer: it reuses DSH's published
`@deepseek-ai/dsh-client-ui-primitives` (`Button`, `Tooltip`, `Icon*`) and the same
public `--dsh-*` / `--dsw-*` tokens the composer card uses
(`--dsh-composer-card-max-width`, `--dsw-specific-input-major`, `--dsw-elevation-soft`,
`--dsw-alias-border-l2`, radius 22). No hashed CSS-module class name and no upstream
component internals are imported.

Two consequences to keep in mind:

- `@deepseek-ai/dsh-client-ui-primitives` must stay in the bundle externals and in
  `dsh.client.inject`. The web shell answers it from its own module seeds, which is how
  DSH's `ui-subagent` and `ui-jobs` bundles consume it too. Dropping the declaration
  leaves the bundle resolving nothing.
- Alignment is asserted against DSH itself: the browser suite requires the panel box
  (x and width) to equal `[data-composer-card]` within a pixel. That attribute is
  already used by DSH's own code, so it is a fair integration point; a token-only check
  would silently accept a narrow panel, which is the regression this guards.

## No stored-question surface

`smart.3` removed the recent-question suggestion list and the stored-history restore, so
the host no longer serves a history route at all: only `ask` and `fork` are registered.
The audit store keeps recording every exchange and `forkThread` still reads it, but
nothing can present earlier questions to the user. `BtwController` never issues a history
read, and a bare `/btw` returns an error instead of opening an empty panel.

A new `/btw` sent from the main composer starts a fresh view (`ask(question, fresh)`);
follow-ups typed inside the panel append to the view on screen. A fork still contains
every successful side exchange recorded up to the chosen answer, including ones made
before the current view — the child is built from the audit, not from what is displayed.

## Limits and honest degradation

A working DSH service contract is required. Missing/changed contracts must be caught
by typecheck and isolated startup tests, not described as automatically supported.
Provider failures are reported without fallback calls. Audit corruption or failures
are never treated as success. Incomplete fork completion requires inspection of the
recorded child ID. Browser state is per session; closing does not discard audit or
cancel work, explicit Cancel does.

The canonical audit schema is independent of DSH. Normal fork logs deliberately use
DSH's validated API, never raw file edits. Thread history and parent history remain
separate until the user requests a fork. A completed parent boundary is used, so
unfinished main-turn context is not silently misrepresented as a completed fork.

## Live activation on this machine

BTW is installed through the profile's own live user patch layer
(`$DSH_HOME/profiles/web/cordis.patch.yml`, `patchReload: live`), not as a profile
dependency, so no DSH restart is needed. `scripts/enable-live.mjs` performs it with
exact-bytes guards and a metadata backup, and refuses the three unrecognised states.

One DSH behaviour matters for upgrades: `clientModules` re-hashes the bundle file at
the path recorded when the loader row was created. Changing only the *path* in the
patch therefore reloads the host half while the browser keeps receiving the previous
client bytes. `smart.3` hit exactly that: `dsh-btw/history` was already 404 while the
served bundle still contained the old UI. The bridge was to write the new
`lib/client.js` over the path the running process already serves (backed up under
`$DSH_HOME/backups/btw-live-mirror-*`).

**From here on, upgrade the contents of the current bundle directory in place** rather
than moving to a new directory name; that path is what the live watcher can follow.
The old `bundles-src/dsh-btw-smart.2` copy is only that one-time bridge for the running
process and becomes dead after the next DSH restart.

## Known test gates

Typecheck, built-module loading, input revision/lifecycle tests, persistence and request
idempotence tests, real Session replay validation, isolated packed-profile/auth tests,
Firefox and Chromium driving real DSH with a fake model, and final user real-provider
acceptance. No claim is made that version-string changes alone establish compatibility.
