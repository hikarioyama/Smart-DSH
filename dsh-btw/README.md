# Smart-DSH BTW — local test candidate

`0.4.0-smart.4`, not released. The old local BTW plugin is not activated or overwritten.
Runtime target: DSH **0.1.5-rc.2**. See [testing and installation](docs/TESTING.md).

## Behavior

- `/btw question` starts an independent, tool-free request; the main task continues.
  The main composer stays the user's own: the automatic claim runs for the bare
  `/btw ` token only and never edits the draft while an IME composition owns it, so
  typing (including Japanese conversion) keeps its colour and caret.
- The panel has its own follow-up input. Successful previous BTW answers are included
  in follow-ups. There is no arbitrary number-of-turns cap; the selected model's
  context limit still applies, and usage grows with the conversation.
- Each request takes a fresh, detached safe prefix of the parent conversation.
- Drag the panel's top edge upward to expand; its height is remembered locally. On a phone the handle stops below the browser bookmarks or favorites bar, so it cannot be dragged out of reach.
  Closing the panel hides it, **not** cancels the request. Cancel BTW cancels only BTW.
- The panel is laid out as a second DSH composer — same card tokens, corner radius and
  maximum width — and its controls reuse DSH's own `Button`, `Tooltip` and icon parts.
- **Nothing about earlier questions is shown.** There is no recent-question suggestion
  list, and no stored history is restored: `/btw` alone opens nothing, and a new
  `/btw` from the main composer starts a fresh view. Follow-ups typed in the panel
  append to the thread currently on screen. Everything is still written to the audit
  store; only the panel stops reading it.
- Each completed answer carries DSH's own branch action (`Branch into a new
  conversation`, the `IconBranchOutline16` button). It creates a normal DSH session
  containing the parent through the recorded completed-turn boundary, followed by
  the successful BTW exchanges recorded up to that answer. Exact recorded assistant
  streams are reused; no new model call is made just to fork.
- A question asked during an unfinished parent turn forks from the **preceding
  completed parent turn**. Hover the button to inspect the anchor. With no completed
  parent turn, or a model answer containing an unexecuted tool call, fork is unavailable.

## Audit

`$DSH_HOME/btw-threads/v1/<sha256-of-session-id>.jsonl` is an append-only versioned
index of questions, answers, errors and fork outcomes. Files are created with mode
0600, directories 0700. The original session ID is recorded inside the file.

Large immutable parent-context snapshots live in `contexts/<sha256>.json`. A question
references its context hash and previous successful side-turn IDs. Model and reasoning
selection, tool schemas, side instructions, answer streams and returned usage are
recorded where available. Provider credentials are not copied into this store.
These files contain private conversation content; treat backups accordingly.

The main session log is not modified by BTW. Only an explicitly created fork gets
side exchanges appended. There is no automatic log deletion. Audit failures block
success; incomplete/corrupt logs are reported rather than silently discarded.
One same-parent request at a time is admitted across tabs; different parents can run
concurrently. A completed request ID is replay-safe. Interrupted requests require a
new identity; no implicit model retry is made.

The audit store is written but not read by the panel. The host exposes only
`dsh-btw/ask` and `dsh-btw/fork`; there is no route that serves stored questions.

## Upgrade boundary

Core storage and lifecycle logic have no DSH imports. Host APIs are isolated in
`src/compat/`; browser input/layout adapters are in `src/client/compat/`, with a thin
registration entry. The panel imports DSH's published UI primitives (`Button`,
`Tooltip`, `MarkdownText`, icons) and the composer's public design tokens. Completed
answers use the host `MarkdownText` renderer (GFM and TeX, raw HTML disabled, unsafe
link protocols dropped). Questions, errors and the in-progress status stay plain text.
No hashed upstream CSS-module class name is referenced.

Model calls use public `LlmRuntime.prepareCall`. No private pi-ai cache manipulation
is active in this candidate: caching is provider-managed, with no cache-saving promise.
Upstream private-cache test fixtures remain for provenance, not production execution.

On an upgrade, update the coordinated dev pin and run unit, package/auth and real
browser/mock-model tests before widening compatibility claims. Public APIs can also
change; isolation reduces maintenance work, it does not guarantee zero changes. When
reinstalling on a running DSH, replace the contents of the existing bundle directory
in place — a new directory name is not picked up live (see `docs/design.md`).

Host foundation and regression fixtures derive from iyllyt/dsh-btw 0.3.0 (MIT).
The new panel, persistent thread, audit store and fork integration are Smart-DSH work.
Original license and attribution are retained.
