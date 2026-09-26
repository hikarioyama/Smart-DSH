# Third-party notices

`dsh-btw` is an independent plugin for DeepSeek Harness.

The cache-boundary adapter in `src/host/btw-pi-ai-adapter.ts` is a small,
version-pinned derivative/integration layer around DeepSeek Harness's
`PiAiAdapter` and pi-ai's public `onPayload` hook. DeepSeek Harness is licensed
under the MIT License:

- https://github.com/deepseek-ai/deepseek-harness
- compatibility targets: `@deepseek-ai/dsh-llm-pi-ai@0.1.5-rc.1` and `0.1.5-rc.2`
- inspected source: `dsh-v0.1.5-rc.2`, commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`

The `/btw` interaction semantics and reminder text are compatible with the
behavior of Anthropic Claude Code's side-question feature. No Claude Code
runtime code is bundled into this package.

Host integration and regression tests derive from iyllyt/dsh-btw, commit 2c3621049153d76bd549ebdd77aa5e453e18aeed (MIT). Original LICENSE is retained. Smart-DSH additions are maintained separately.
