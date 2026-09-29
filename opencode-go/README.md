# OpenCode Go 全モデル展開 (2026-09-29)

`$DSH_HOME/settings.yaml` の `llm-pi-ai.providers` に、OpenCode Go 全モデル (30 ID)
を **微妙な wire プロトコル差も含めて** 実測検証の上で展開した。

## 最終形 (settings.yaml)

| ルート | api | contains |
| --- | --- | --- |
| `opencode-go` | (カタログ継承, 混在) | pi-ai 0.85.1 同梱カタログにある ID 21 個。api/baseUrl/cost/compat は同梱のものを 100% 継承。 |
| `opencode-go-completions` | `openai-completions` @ `https://opencode.ai/zen/go/v1` | 同梱カタログにない ID 6 個: `deepseek-v4.1-flash`, `deepseek-flash`(別名), `mimo-v2.6-flash`, `mimo-v2.6-pro`, `longcat-2.5-preview-free`, `space-bunny-free` |
| `opencode-go-responses` | `openai-responses` @ `https://opencode.ai/zen/go/v1` | 同梱カタログにない ID 2 個: `gpt-6-luna`, `grok-4.7` |

`:id` で並べただけのエントリは pi-ai 同梱カタログの name/contextWindow/maxTokens/input/reasoning/thinkingLevelMap を全て継承する。手動宣言ルートのエントリはこの継承が効かないため、name/contextWindow/maxTokens/input/compat を明示する。

**なぜ手動宣言ルートに分けるのか**: dsh-llm-pi-ai の `resolveEntry` は、同梱カタログにない ID に対して route-level の `api`/`baseURL` を要求する (strict validation)。一方の手動ルートは、本流ルートのモデル (minimax-m3 は anthropic-messages、gpt-5.6-luna は openai-responses など) では、`route-level api` を設定すると上書きされてしまう。したがって、ルートレベルの値を上書きすることはできない。

## Wired プロトコルの実測 (2026-09-29)

- `minimax-m3` は `/v1/messages` (anthropic) — pi-ai カタログはこのため `baseUrl: https://opencode.ai/zen/go` (SDK が `/v1/messages` を追加する)。
- `minimax-m2.7` は **廃番、実測で chat/completions が 400 (ModelProtocolUnsupported)、messages は 200** — しかし anthropic 専用で同梱カタログは既にリング上古い。よって除外する。
- `qwen3.8-*` / `qwen3.7-plus` は chat (openai) と messages (anthropic) の **両方** を受け付け、tool 呼ばれが streaming で動作することも確認済 → 同梱カタログ定義 (openai-completions) を継承。
- `grok-4.6` / `gpt-5.6-luna` / `muse-spark-*` は `/v1/responses` (OpenAI Responses) を要求する (他の方法は 400 `ModelProtocolUnsupported`)。
- DeepSeek 系は **OpenCode console にて Privacy を Global に設定しない限り 400**: まだ Global を設定していないため、DeepSeek 4 系 (vision 除外) 全てが要求でエラーになる。
- `muse-spark-*` は **OpenCode console で 「学習許可」を別途 ON にしない限り 400**。
- Streaming 専用化: `glm-5.3-flash` にて、probe に `stream: false` を送ると 400 (`[streaming_only]`) になるが、pi-ai は常に streaming するため、運用上問題なし。

## 廃番 (deprecated) 確認済で除外

- `kimi-k2.6` — 2026-09-29 に `HTTP 410 ModelDeprecated` 確認済。
- `omen-alpha` — 同じく `410 ModelDeprecated`。
- `minimax-m2.7` — 同じく実測で wire が protocol mismatch で疎通しない (廃番ではなく protocol mismatch)。

## reasoningEfforts の規則

- 本流ルートの同梱カタゴリ系 ID は、`reasoningEfforts` を設定しない (継承が最も正確)。
- 手動ルートのエントリのみ、兄弟モデルの thinkingLevelMap由来 の明示を書く:
  - `deepseek-v4.1-flash` / `deepseek-flash` → `{ low, high, max }`
  - `gpt-6-luna` → `{ off: null, low, medium, high, xhigh, max }` (gpt-5.6-luna 写し)
- `grok-4.7` は **xAI が `reasoning_effort: "none"` を受け付けない** (実測 400) ので
  DSH 側は **非 reasoning モデル** として宣言 (efforts を書かない)。
- DSH の制約で、`reasoningEfforts` の key に `null` を置いてよいのは **`off` だけ**。
  他のレベルに null を書くと, モデルは解決不能となる。DSH 同様に pyyaml (YAML 1.1)
  で `off:` を boolean に変える事象に注意 (settings の書き換えは **yaml npm (1.2) に限る**)。

## 検証コマンド

```sh
sh tools/expand-ocgo-models/verify.sh               # /chat/completions (SSE) 全モデル PID
# 任意モデルの手動 E2E (使い捨て DSH_HOME):
node tools/expand-ocgo-models/set-default-model.cjs /tmp/dsh-x/settings.yaml opencode-go-responses gpt-6-luna
DSH_HOME=/tmp/dsh-x dsh --profile headless "Reply with exactly: OK"
```

2026-09-29 の E2E 実測 (使い捨て DSH_HOME):
- `opencode-go` ルート継承 モデル 5 種 (glm-5.3-flash / qwen3.8-flash / qwen3.7-plus / minimax-m3 / gpt-5.6-luna / hy4-preview / kimi-k3) → 200 OK。
- `opencode-go-completions` → mimo-v2.6-flash / space-bunny-free / longcat-2.5-preview-free → OK。
- `opencode-go-responses` → gpt-6-luna → OK; grok-4.7 → 400 は xAI が `none` を拒否 → 非対象化 (上記)。

## 疎通が確認できていない点

- DeepSeek 系 (Global region は OpenCode console でユーザーが設定する必要) —
  classify 済: probe は 400 (Global regions 未許可)。
- muse-spark ×2 (train-consent は別スイッチ) — probe は 400 (train on request)。

## 手動宣言ルートの結論

manually-declared ルートはライセンス上 の pi-ai 同梱カタログに存在しない
モデル (mimo-v2.6, longcat-2.5, space-bunny, gpt-6-luna, grok-4.7 と、まさに
これらの全グループ) を DSH 側の制約上 **「新しい pi-ai バージョンに変えるまでは」**
とりあえず使用できるようにする。pi-ai が 0.86+ に更新されて同カタログに新しい
モデルが追加された時は、手動ルートのエントリは消して完全に同梱カタログに吸収させる。
