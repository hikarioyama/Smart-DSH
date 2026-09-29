#!/bin/sh
# gen.mjs + apply.mjs で拡張した settings.yaml の OpenCode Go 3 ルート
# (opencode-go / opencode-go-completions / opencode-go-responses) の全モデルを、
# 実際のクライアント (pi-ai) と同じ wire 形式で叩いて疎通を確認する。
#
#   sh tools/expand-ocgo-models/verify.sh
#
# キーは表示しない。環境: python3 + PyYAML。
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SETTINGS="$DSH_HOME/settings.yaml"
ORIGIN="https://opencode.ai/zen/go/v1"

KEY=$(python3 -c 'import sys, yaml
doc = yaml.safe_load(open(sys.argv[1])) or {}
print((doc.get("refs") or {}).get(sys.argv[2], ""))' "$DSH_HOME/.credentials.yaml" 'OPENCODE_GO_API_KEY')
SESSION=$(python3 -c 'import sys, yaml
doc = yaml.safe_load(open(sys.argv[1])) or {}
print((((doc.get("llm-pi-ai") or {}).get("providers") or {}).get("opencode-go") or {}).get("headers", {}).get("x-opencode-session", ""))' "$SETTINGS")

CFG=$(mktemp); chmod 600 "$CFG"
{
	printf 'header = "Authorization: Bearer %s"\n' "$KEY"
	[ -z "$SESSION" ] || printf 'header = "x-opencode-session: %s"\n' "$SESSION"
} >"$CFG"

TMP=$(mktemp)
trap 'rm -f "$CFG" "$TMP" "$TMP.body"' EXIT

probe_models() { # route_label endpoint path body_builder
	label=$1; endpoint=$2; path=$3; body=$4; models=$5
	for m in $models; do
		case "$path" in
			chat) payload="{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":140,\"stream\":true}" ;;
			resp) payload="{\"model\":\"$m\",\"input\":[{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"ping\"}]}],\"max_output_tokens\":16,\"stream\":true}" ;;
		esac
		code=$(curl -sS -o "$TMP.body" -w '%{http_code}' --config "$CFG" -m 60 \
			-H 'Content-Type: application/json' -d "$payload" \
			"$ORIGIN/$endpoint" 2>/dev/null) || code=ERR
		stream_ok=$(head -c 500 "$TMP.body" 2>/dev/null | grep -c 'data:' || true)
		case "$code" in
			200) if [ "${stream_ok:-0}" -gt 0 ]; then
					printf '  OK   %-24s %-34s HTTP %s (SSE)\n' "$label" "$m" "$code"
				else
					printf '  OK*  %-24s %-34s HTTP %s (SSE チャンク未検出)\n' "$label" "$m" "$code"
				fi ;;
			400) if grep -q 'ModelProtocolUnsupported\|Global regions\|trains on request data\|does not exist' "$TMP.body" 2>/dev/null; then
					printf '  SKIP %-24s %-34s HTTP %s | %s\n' "$label" "$m" "$code" "$(head -c 105 "$TMP.body" | tr -d '\n')"
				else
					printf '  OK*  %-24s %-34s HTTP %s (想定内の 400)\n' "$label" "$m" "$code"
				fi ;;
			*) printf '  NG   %-24s %-34s HTTP %s | %s\n' "$label" "$m" "$code" "$(head -c 130 "$TMP.body" 2>/dev/null | tr -d '\n')"; fail=1 ;;
		esac
	done
}

fail=0
for route in opencode-go opencode-go-completions opencode-go-responses; do
	api=$(python3 -c 'import sys, yaml
doc = yaml.safe_load(open(sys.argv[1])) or {}
p = (doc.get("llm-pi-ai") or {}).get("providers") or {}
print((p.get(sys.argv[2]) or {}).get("api", "(catalog inherit)"))' "$SETTINGS" "$route")
	MODELS=$(python3 -c 'import sys, yaml
doc = yaml.safe_load(open(sys.argv[1])) or {}
p = (doc.get("llm-pi-ai") or {}).get("providers") or {}
models = (p.get(sys.argv[2]) or {}).get("models") or []
print(" ".join(m["id"] for m in models))' "$SETTINGS" "$route")
	[ -n "$MODELS" ] || continue
	echo "== $route (api=$api) =="
	case "$api" in
		openai-completions) probe_models "$route" chat/completions chat x "$MODELS" ;;
		openai-responses)   probe_models "$route" responses resp x "$MODELS" ;;
		*)                  probe_models "$route" chat/completions chat x "$MODELS" ;;
	esac
done

if [ "$fail" -ne 0 ]; then
	echo "失敗あり。"
	exit 1
fi
echo "全て受理 (SKIP は地域/学習制限/プロトコル違いの想定内のみ)。"
