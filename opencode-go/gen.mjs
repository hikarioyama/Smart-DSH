#!/usr/bin/env node
/**
 * OpenCode Go の現行モデル全文を DSH settings.yaml 向け YAML に起こす。
 *
 *   node gen.mjs [--no-deepseek] [--out <path>]
 *
 * 出力は 3 ルート分の断片 (YAML マーカー区切り):
 *   opencode-go            … pi-ai 0.85.1 同梱カタログにある ID (api/baseURL 継承)
 *   opencode-go-completions … 同梱カタログに無い chat-completions 系新モデル
 *   opencode-go-responses   … 同梱カタログに無い responses 系新モデル
 *
 * 新モデルを別ルートに隔離する理由: dsh-llm-pi-ai の resolveEntry は「同梱
 * カタログに無い ID」に route-level api/baseURL を要求する (strict 解決の
 * 規則)。本流 opencode-go ルートは anthropic / completions / responses の
 * 混在のため route-level api を置けないので、カタログ未収録のモデルだけを
 * 手動宣言ルートへ出すのが唯一の安全な形。
 *
 * reasoningEfforts の規則 (resolveModelReasoning の実測):
 *   - エントリで宣言しない場合 → 同梱カタログの thinkingLevelMap を継承
 *     (本流ルートの同梱 ID は書かない == 継承させるのが正)。
 *   - 手動宣言ルートはカタログ継承が効かないので、明示する必要がある。
 *   - null を許すのは level "off" だけ。他のレベルに null を書くと
 *     INVALID_CONFIG (reasoningEfforts.<level> needs the wire value) で
 *     モデルが解決不能になる。よって「非 null の wire 値だけ」を書き、
 *     未宣言レベルは解決側で null (非対応) に自動固定される。
 */
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

import { existsSync, realpathSync } from "node:fs";

/**
 * lで explorándose PATH 上の `dsh` 実行体から DSH パッケージルートを解決する
 * (BUNDLE を ~/.npm-global に置いていない環境でも動くように)。
 * 環境変数 PI_AI_DIR / DSH_ROOT があればそちらを優先する。
 */
function dshRoot() {
	if (process.env.PI_AI_DIR) return process.env.PI_AI_DIR;
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const link = join(dir, "dsh");
		if (!existsSync(link)) continue;
		try {
			// …/@deepseek-ai/dsh/lib/bin.js → …/@deepseek-ai/dsh
			return dirname(dirname(realpathSync(link)));
		} catch {
			/* 壊れた symlink は無視して次の候補へ */
		}
	}
	throw new Error("dsh not found on PATH (gen.mjs)");
}
const PI_AI = process.env.PI_AI_DIR ?? join(dshRoot(), "node_modules", "@earendil-works", "pi-ai");
const { OPENCODE_GO_MODELS } = createRequire(import.meta.url)(join(PI_AI, "dist/providers/opencode-go.models.js"));

const argv = process.argv.slice(2);
const noDeepseek = argv.includes("--no-deepseek");
const outAt = argv.indexOf("--out");
const OUT = outAt >= 0 ? argv[outAt + 1] : "/tmp/ocgo-delta.yaml";

/** 同梱カタログに無いモデル (2026-09-29 実測で応答するものだけを採用)。
 *  efforts は兄弟モデルの thinkingLevelMap から null を除いた写し (下記参照)。 */
const UNBUNDLED = {
	"deepseek-v4.1-flash": {
		name: "DeepSeek V4.1 Flash",
		efforts: { low: "low", high: "high", max: "max" }, // v4-flash の写し (null 抜き)
	},
	"deepseek-flash": {
		name: "DeepSeek Flash (alias; 実体未確認・Global 許可後に verify 推奨)",
		efforts: { low: "low", high: "high", max: "max" },
	},
	"mimo-v2.6-flash": { name: "MiMo V2.6 Flash", contextWindow: 1048576, maxTokens: 131072, input: ["text", "image"] },
	"mimo-v2.6-pro": { name: "MiMo V2.6 Pro", contextWindow: 1048576, maxTokens: 131072, input: ["text"] },
	"longcat-2.5-preview-free": { name: "LongCat 2.5 Preview Free (limited time)", input: ["text"] },
	"space-bunny-free": { name: "Space Bunny Free (limited time)", contextWindow: 1048576, maxTokens: 524288, input: ["text"] },
	"gpt-6-luna": {
		name: "GPT-6 Luna", contextWindow: 1050000, maxTokens: 128000, input: ["text", "image"],
		efforts: { off: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, // gpt-5.6-luna 写し
	},
	"grok-4.7": {
		name: "Grok 4.7", contextWindow: 500000, maxTokens: 500000, input: ["text", "image"],
		// xAI は `reasoning_effort: none` を受け付けないため、DSH 側で thinking
		// パラメータを送らない (reasoningEfforts: false)。effort 制御はその代償。
		efforts: false,
	},
};

/** 手動宣言ルートは同梱カタログの compat 継承が効かないため明示する。 */
const DEEPSEEK_COMPAT = () => ({
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
	requiresReasoningContentOnAssistantMessages: true,
	thinkingFormat: "deepseek",
});
const PLAIN_COMPAT = () => ({ supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" });
const COMPAT = {
	"deepseek-v4.1-flash": DEEPSEEK_COMPAT(),
	"deepseek-flash": DEEPSEEK_COMPAT(),
	"mimo-v2.6-flash": PLAIN_COMPAT(),
	"mimo-v2.6-pro": PLAIN_COMPAT(),
	"longcat-2.5-preview-free": PLAIN_COMPAT(),
	"space-bunny-free": PLAIN_COMPAT(),
	// gpt-6-luna / grok-4.7 (responses ルート): pi-ai の Responses 実装は
	// compat 無指定でも動作する (sessionAffinityFormat はキャッシュ最適化の指定)。
};

const catalog = [];
function push(id, spec = {}) { catalog.push({ id, ...spec }); }

if (!noDeepseek) {
	push("deepseek-v4-flash", {});
	push("deepseek-v4.1-flash");
	push("deepseek-flash");
	push("deepseek-v4-pro", { name: "DeepSeek V4 Pro (Off-Peak $0.66 / Peak $1.32)" });
	push("deepseek-v4-flash-vision-exp", {});
}
push("glm-5.2", { input: ["text", "image"] });
push("glm-5.3", {});
push("glm-5.3-flash", { input: ["text", "image"] });
// kimi-k2.6 / omen-alpha は 2026-09-29 実測 410 ModelDeprecated → 除外
push("kimi-k3", {});
push("kimi-k2.7-code", {});
push("mimo-v2.5", {});
push("mimo-v2.5-pro", {});
push("mimo-v2.6-flash");
push("mimo-v2.6-pro");
push("longcat-2.0", {});
push("longcat-2.5-preview-free");
push("hy3", {});
push("hy4-preview", {});
// minimax-m2.7 は同梱カタログが openai-completions を向いているが実測で
// chat/completions が 400 (ModelProtocolUnsupported) → 型落ちとして除外
push("minimax-m3", {});
push("qwen3.8-flash", {});
push("qwen3.8-max", {});
push("qwen3.7-plus", {});
push("space-bunny-free");
push("gpt-5.6-luna", {});
push("gpt-6-luna");
push("grok-4.6", {});
push("grok-4.7");
push("muse-spark-1.2-contributor", {});
push("muse-spark-1.3-contributor", {});

const bundledIds = catalog.filter((m) => OPENCODE_GO_MODELS[m.id] && !(m.id in UNBUNDLED));
const completionsIds = catalog.filter((m) => m.id in UNBUNDLED && m.id !== "gpt-6-luna" && m.id !== "grok-4.7");
const responsesIds = catalog.filter((m) => m.id === "gpt-6-luna" || m.id === "grok-4.7");

const IND = "        ";
const IND1 = IND + "  ";
const IND2 = IND1 + "  ";

/**
 * thinkingLevelMap (pi-ai) → reasoningEfforts (settings.yaml) 相当へ変換。
 * 戻り値は [key, value] の配列。null は level "off" に限り許される (空=送らない)。
 * それ以外の null は未宣言として落とす (解決側で自動的に非対応固定になる)。
 */
function mapEffective(lm) {
	if (!lm || typeof lm !== "object") return undefined;
	const pairs = [];
	const off = lm.off;
	if (off !== undefined) pairs.push(["off", off === null ? "null" : off]);
	let nonNull = 0;
	for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
		const v = lm[level];
		if (v === undefined || v === null) continue;
		pairs.push([level, v]);
		nonNull++;
	}
	if (nonNull === 0) return undefined;
	return pairs;
}

function emitModel(m) {
	const base = OPENCODE_GO_MODELS[m.id];
	const unb = UNBUNDLED[m.id] ?? {};
	// 同梱カタログに無い ID (手動宣言ルート側) だけがカタログ継承の対象外。
	const onHandRoute = base === undefined || completionsIds.includes(m) || responsesIds.includes(m);
	const name = m.name ?? base?.name ?? unb.name ?? m.id;
	const contextWindow = m.contextWindow ?? base?.contextWindow ?? unb.contextWindow ?? 262144;
	const maxTokens = m.maxTokens ?? base?.maxTokens ?? unb.maxTokens ?? 32768;
	const input = m.input ?? base?.input ?? unb.input;
	const effSrc = m.efforts ?? unb.efforts ?? base?.thinkingLevelMap;
	// 本流ルートの同梱 ID は efforts を書かない (カタログ継承が最も正確)。
	// 手動宣言ルートのモデルだけ明示する。
	// efforts === false は「非 reasoning として宣言」を意味する。
	const explicitFalse = effSrc === false;
	const pairs = (onHandRoute && !explicitFalse) ? mapEffective(effSrc) : undefined;
	const compat = COMPAT[m.id];
	const out = [];
	out.push(`${IND}- id: ${m.id}`);
	out.push(`${IND1}name: ${yamlStr(name)}`);
	out.push(`${IND1}contextWindow: ${contextWindow}`);
	out.push(`${IND1}maxTokens: ${maxTokens}`);
	if (input) out.push(`${IND1}input: ${JSON.stringify(input)}`);
	if (pairs) {
		out.push(`${IND1}reasoningEfforts:`);
		for (const [k, v] of pairs) out.push(`${IND2}${k}: ${v}`);
	}
	if (compat) {
		out.push(`${IND1}compat:`);
		for (const [k, v] of Object.entries(compat)) out.push(`${IND2}${k}: ${JSON.stringify(v)}`);
	}
	return out;
}

const lines = [];
lines.push("--- opencode-go (bundled-catalog route) ---");
for (const m of bundledIds) lines.push(...emitModel(m));
lines.push("");
lines.push("--- opencode-go-completions route ---");
for (const m of completionsIds) lines.push(...emitModel(m));
lines.push("");
lines.push("--- opencode-go-responses route ---");
for (const m of responsesIds) lines.push(...emitModel(m));

function yamlStr(s) { return JSON.stringify(s); }

writeFileSync(OUT, lines.join("\n") + "\n");
console.error(`wrote ${catalog.length} models (bundled ${bundledIds.length} / completions ${completionsIds.length} / responses ${responsesIds.length}) → ${OUT}`);
