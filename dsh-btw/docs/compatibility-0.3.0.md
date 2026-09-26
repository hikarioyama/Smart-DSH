# dsh-btw 0.3.0 — DSH API upgrade evidence

## Scope and source

Validated on Windows with Node.js `24.16.0`, pnpm `11.21.0`, on 2026-09-11–12
(Asia/Shanghai). The final packed code passed both Profile checks again on
2026-09-12; frozen-lockfile installation, typecheck, 22 tests, and `git diff
--check` also passed. See [machine-readable check summary](./validation-0.3.0.json).
This is an API, packaging, and disposable-Profile lifecycle check, **not full
browser or real-provider acceptance**. No real user Profile was modified; no
model API key or paid model request was used.

Separately, on 2026-09-12 the user reported successful actual use on Windows /
DSH `0.1.5-rc.1`. Read-only resolution checks from the installed plugin confirmed
`dsh-llm`, `dsh-llm-pi-ai`, and `dsh-session` resolved to host rc.1 packages.
This is user-reported functional acceptance, not an automated provider test.
The provider/model and individual interaction cases were not supplied; it does
not establish complete cache, cancellation, or browser acceptance.
See [installation notes](./install-windows.md).

Official sources inspected:

- [DSH 0.1.5-rc.2 source](https://github.com/deepseek-ai/deepseek-harness/tree/fb2c4b9e698e30edb738bca4cf0618587db7d203), tag `dsh-v0.1.5-rc.2`.
- [rc.1 → rc.2 comparison](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2).
- Official npm packages and their exported `.d.ts` contracts for both releases.

At inspection time npm `latest` was `0.1.5-rc.1` and `next` was `0.1.5-rc.2`.
These tags can move; the declarations below refer only to exact versions.

## Compatibility matrix

| DSH | Author declaration | Evidence |
| --- | --- | --- |
| `0.1.5-alpha.1` | `unknown` | Not tested |
| `0.1.5-alpha.2` | `unknown` | Not tested |
| `0.1.5-rc.1` | `compatible` | Typecheck, automated tests, isolated install/start/RPC/uninstall |
| `0.1.5-rc.2` | `compatible` | Typecheck, automated tests, build, isolated install/start/RPC/uninstall |

`compatible` is an author declaration within the evidence above. It does not
claim automated real-provider or comprehensive Web UI acceptance, or DSH STORE
approval. The user report above is recorded separately. No `dshOperations` record is
invented from unit tests. Node.js 22, macOS, Linux, and rollback remain untested.
The old `0.1.0-rc.6` runtime is outside this version's supported range.

## API changes

- Replaced removed `dsh-client-runtime/client` imports with `dsh-client-store`,
  `dsh-api-session-controller/client`, Cordis Context, and `dsh-session/types`.
- Included the renderer's Context augmentation and manifest injection; browser
  externals now match the official platform module table.
- Preserved system-role messages and their later updates from
  `Session.deriveMessages()`. The new `EpochHeader` has no `system` field;
  duplicating a separate system prompt would change the request prefix.
- Updated `CallId` fixtures to the official `ToolCallId` constructor and added
  completed-tool-exchange regression coverage.
- Added the required `MarkdownLabels` props.
- Registered one exact Fetch route, `/api/dsh-btw/ask`, through the public
  `Connection.fetch.register()` API. Connection still owns Host/Origin checks,
  browser authentication, request buffering and disconnect cancellation. This
  does not replace the shared RPC interceptor or any official component.
- Real Profile testing caught an injection failure in the dedicated-channel
  `rpc.handle()` path under the new Cordis tracing context. No official source
  was patched; the plugin uses the public additive Fetch route instead.
- Retained per-request pi-ai cache-boundary isolation, froze each call's
  profiles, preserved the new auth injection, and added fail-closed checks.
  This bridge still reads version-specific adapter internals; it is not a
  guarantee of forward compatibility.
- Pinned the local DSH dependency graph to one official release. Transitive
  prerelease ranges otherwise mixed rc.1 and rc.2 and produced nominal-type
  conflicts. Peer ranges allow exactly the two tested releases.

## Automated checks

- TypeScript source typecheck passed against coherent rc.1 and rc.2 graphs.
- 22 tests passed: system-history preservation, balanced tool calls, cache
  boundaries, isolated pi-ai construction/auth hooks, input interception,
  controller teardown, private transcript isolation, RPC envelope validation,
  the real official `LlmRuntime.prepareCall()` with a local fake adapter, and
  browser-bundle loading against the new platform module table.
- Host/browser bundles and type declarations rebuilt and committed artifacts
  updated in the working tree. Host and client source maps are packaged.

Run from the plugin checkout:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm test
pnpm pack --pack-destination <artifact-directory>
```

For a different supported matrix row, change the DSH devDependency versions
and the `dshRelease` anchor in `pnpm-workspace.yaml` together, reinstall, and
rerun. The delivered lockfile/build target is rc.2. Do not mix prerelease graphs
or silently reinterpret an rc.2 dependency as an rc.1 validation.

## Disposable Profile evidence

For both versions, the official CLI was installed separately with install
scripts disabled. The rc.1 runtime additionally pinned its full DSH dependency
graph to rc.1, so the check did not silently run rc.2 internals.

`scripts/smoke-profile.mjs` creates a fresh temporary `DSH_HOME` for each run,
installs a packed plugin without lifecycle scripts, starts a loopback-only
Web server on an OS-assigned port without opening a browser, and checks:

1. Plugin installation exits successfully.
2. Composed configuration includes the additive `id: btw` entry.
3. Official Web Profile starts with the plugin loaded.
4. Unauthenticated calls to the plugin path return HTTP 401.
5. A temporary authenticated browser cookie can call that path; malformed
   payloads return `bad-request`, and a nonexistent session returns
   `session-not-found` in a correlated RPC envelope.
6. The script stops its own test process, uninstalls the plugin, and confirms
   `id: btw` is absent from the composed configuration.

All six checks passed for rc.1 and rc.2. Startup credentials stay inside the
temporary Profile and are not printed. Temporary directories are retained
for diagnosis; the test plugin is removed after the check. Process termination
is not presented as proof of graceful in-flight model cancellation.

```powershell
node scripts/smoke-profile.mjs <official-dsh/lib/bin.js> <dsh-btw-0.3.0.tgz> <pnpm-store-directory>
```

The script emits a bounded JSON report with the exact CLI/Node version and
individual check results. It explicitly reports `realModelCall: not-run`.

## Remaining acceptance work

- In a disposable Web Profile with an explicitly supplied model credential,
  ask `/btw` while the main agent is busy; inspect rendering, keyboard dismissal,
  cancellation, and main-session history isolation.
- Validate Anthropic cache markers on an actual provider request and confirm
  other configured providers generate normally.
- Validate rollback and any additional OS/Node/DSH versions before claiming them.
- Commit and push the reviewed changes to trigger STORE's new fixed-commit
  review. Passing the local checks is not a promise of relisting.
