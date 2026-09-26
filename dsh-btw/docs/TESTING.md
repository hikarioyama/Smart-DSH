# Local acceptance — not a public release

## Automated gates

From `dsh-btw/`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
# DSH_CLI is the real installed dsh/lib/bin.js, not a production login URL.
node scripts/smoke-profile.mjs "$DSH_CLI" artifacts/dsh-btw-0.4.0-smart.4.tgz
node scripts/browser-profile.mjs "$DSH_CLI" artifacts/dsh-btw-0.4.0-smart.4.tgz "$CHROMIUM"
# Stock Firefox, automated via Playwright 1.58 WebDriver BiDi:
node scripts/browser-profile.mjs --firefox "$DSH_CLI" artifacts/dsh-btw-0.4.0-smart.4.tgz "$FIREFOX"
```

Browser tests need the chosen browser executable and `zstd` on PATH. Installation
and browser tests isolate HOME, XDG directories and DSH_HOME; they do not inherit
credential environment variables. The browser suite uses a private loopback server,
authentication cookie and fake model. Chromium uses `--disable-gpu`; Firefox uses
software rendering, `--no-remote` and a separate profile. Existing browser windows,
production DSH and GPU jobs are left alone. Only test-owned child processes stop.
Temporary evidence is retained, including `report.json` and screenshots.

DSH 0.1.5-rc.2 has a separate Firefox JSON-validator incompatibility. Firefox tests
require the guarded host fix in `../../scripts/apply-firefox-json-fix.mjs` to have
been applied beforehand (or an upstream equivalent). The BTW harness does not patch
host files. A pass here is not a claim that unmodified DSH 0.1.5-rc.2 supports Firefox.

Optional addon source/package directories may follow the browser executable. Only
package/code files are copied, not their settings or credentials. This supports
combined tests with notify-push, esc-stop, native-codex-oauth and commandcode.
Loading these addons is not a real push-delivery or provider-acceptance test.

Gates: host/client typecheck and build, unit regressions (including 100 follow-ups,
service recreation, cancellation, a bare `/btw` opening nothing, and damaged audit data),
packed-profile installation, boot/auth/uninstall, genuine DSH browser interaction,
repeated side questions and context inheritance, pending model selection, resize,
main-task concurrency, explicit cancellation and narrow viewport.

The browser suite also asserts the redesigned surface: the panel box (x and width) equals
`[data-composer-card]`, and **no stored question is ever surfaced** — after closing, after
a new `/btw`, and after this suite's own DSH restart there is no recent-question list and
no history restore, the removed history route is absent from the wire, and a repeated fork
of a completed turn reuses the recorded child without a second session. Fork content is
checked against disk: the child must stop at the recorded anchor.

Parent logs must contain no side prompts. Browser exceptions and rejected
`[ui-input-trigger]` suggestion sources both fail the test.

The private-cache and legacy sidechain unit fixtures are inherited upstream tests;
they are not the production storage or model-call path in this candidate.

## User-operated installation

Do not do this while important DSH turns are running. The helper **never stops or
restarts anything**. GPU training/preview processes are not part of this procedure.

On this machine BTW is activated through the profile's live user patch layer, which
needs no restart. Check first, then apply:

```sh
node scripts/enable-live.mjs --check
node scripts/enable-live.mjs --apply
```

It refuses an unknown patch state, backs up the patch metadata under
`$DSH_HOME/backups/btw-live-*`, and only ever adds or swaps the single `btw` entry.

The older `install-local-test.sh` path installs BTW as a profile dependency and does
require stopping `dsh-web.service` yourself:

```sh
bash scripts/install-local-test.sh --check
# Only after ALL DSH turns are idle:
systemctl --user stop dsh-web.service
bash scripts/install-local-test.sh --apply
# If installation failed, inspect its error and backup before proceeding.
systemctl --user start dsh-web.service
```

Reload every browser tab after either route. `docs/design.md` records the upgrade
constraint: DSH re-hashes the bundle file at the path its loader row recorded, so
upgrade the contents of the current bundle directory in place instead of moving to a
new directory name, or the browser keeps receiving the previous client bytes.

## Manual acceptance checklist

1. In a disposable normal conversation, send one main message and let it finish.
2. Ask `/btw` about something from that conversation. Confirm the main transcript
   does not receive the side question, and the separate panel answers.
3. Compare the panel with the composer below it: same width, same rounded card, same
   button family. Drag the panel's top edge upward/downward. Scroll a long answer;
   verify both the side and main inputs remain usable at your normal Firefox size.
4. Confirm no earlier question is offered anywhere: typing `/btw` should show only the
   command entry, and pressing Enter on a bare `/btw` should ask you for a question
   rather than opening a list. A new `/btw` should show only that new exchange.
5. Run a harmless main task concurrently and ask another side question. Cancel BTW;
   the main task must continue. Closing the panel alone must not cancel BTW.
6. Use the branch button on an answer. Confirm the new normal session contains the
   parent through the recorded completed-turn boundary plus the side exchanges recorded
   up to that answer, and that later main or side turns are excluded. The fork itself
   makes no model request.
7. Remove the panel from your workflow for now: nothing about an earlier question
   should be recoverable in the UI, before or after a DSH restart.
8. Check the audit directory with your normal tools. It contains private text,
   exact side-answer streams and immutable parent-context snapshots. Do not publish
   these files with the repository.
9. Check notifications and Esc-to-stop in your normal environment. Automated
   combined-addon runs load those plugins' code, but do not verify real push delivery
   or every keyboard interaction and setting in your daily profile.

Completed answers render through the host `MarkdownText` primitive inside a DSH-styled
card. Questions, errors and the in-progress line stay plain text. Actual provider
output, quota/cache behavior and long-session performance need your test; a
mock-provider browser pass is not a claim that those are verified.

## Disable / rollback

The live route is a single patch entry plus one code directory:

```sh
# Stop loading BTW (no restart): remove the `btw` insert from
# $DSH_HOME/profiles/web/cordis.patch.yml, restoring the backup if you prefer.
```

The dependency route, at a safe idle time, is:

```sh
dsh plugin --profile web remove -w dsh-btw --ignore-scripts
systemctl --user start dsh-web.service
```

Refresh tabs. Audit files and the old/new bundle directories are retained. Backups live
under `$DSH_HOME/backups/btw-live-*` (patch metadata) and `btw-live-mirror-*` (the file
written over the previously served path); restore only after checking for unrelated
profile changes made since the backup. The `bundles-src/dsh-btw-smart.2` copy exists only
to feed the process that was running during the `smart.3` activation and is dead after a
restart.

## Publication gate

The candidate remains private/uncommitted until the user accepts real behavior.
Do not describe unresolved main-chat rendering or image-input issues as fixed by
this BTW implementation. Codex Fast work is separate and has not been activated.
