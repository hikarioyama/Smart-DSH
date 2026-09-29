#!/usr/bin/env node
/**
 * gen.mjs の出力を $DSH_HOME/settings.yaml に適用する。
 *
 *   node apply.mjs [--dry-run] [--no-deepseek]
 *
 * 変更内容:
 *   1. llm-pi-ai.providers.opencode-go.models … 同梱カタゴル流ルート
 *      (pi-ai 0.85.1 カタログ内の ID + deepseek-v4-flash-vision-exp)
 *   2. llm-pi-ai.providers.opencode-go-completions … 同梱カタログに無い
 *      chat-completions 系新モデル (api/baseURL/compat を明示)
 *   3. llm-pi-ai.providers.opencode-go-responses … 同梱カタログに無い
 *      responses 系新モデル (gpt-6-luna / grok-4.7)
 *
 * opencode-go 本流ルートに api を設定しない理由: models 全体が「混在 API」
 * (anthropic-messages / openai-completions / openai-responses) のため route-level
 * api を置くと全部が上書きされて壊れる。新規モデルだけ別ルートに隔離する。
 *
 * settings.yaml は yaml Document API で 1 セクションだけ差し込むので既存の
 * コメント/書式は保持される。書き込み前には backups へ退避 (restore.sh 付き)。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"));
const SETTINGS = join(DSH_HOME, "settings.yaml");
const BACKUP_ROOT = join(DSH_HOME, "backups");
/** PATH 上の `dsh` 実行体から DSH パッケージルートを解決する (PI_AI_DIR で上書き可)。 */
function dshRoot() {
	if (process.env.PI_AI_DIR) return process.env.PI_AI_DIR;
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		const link = join(dir, "dsh");
		if (!existsSync(link)) continue;
		try {
			return dirname(dirname(realpathSync(link)));
		} catch {
			/* 壊れた symlink は無視して次の候補へ */
		}
	}
	throw new Error("dsh not found on PATH (apply.mjs)");
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const noDeepseek = argv.includes("--no-deepseek");

// ---- 1. gen.mjs → 3 ルート分の断片
const genOut = dryRun ? "/tmp/ocgo-delta.yaml" : "/tmp/ocgo-delta.yaml";
const gen = spawnSync(process.execPath, [join(HERE, "gen.mjs"), ...(noDeepseek ? ["--no-deepseek"] : []), "--out", genOut], {
	stdio: ["ignore", "ignore", "inherit"],
	cwd: HERE,
});
if (gen.status !== 0) {
	console.error("gen.mjs 失敗");
	process.exit(1);
}

const require2 = createRequire(import.meta.url);
function loadYaml() {
	const roots = [];
	for (const root of roots) {
		try {
			return require2(join(root, "node_modules", "yaml"));
		} catch {
			/* 次の候補へ */
		}
	}
	throw new Error("yaml モジュールが見つかりません");
}
const YAML = loadYaml();

// gen.mjs は 3 ルート分を 1 ファイルに書く → マーカーで分割して parse する。
const raw = readFileSync(genOut, "utf8");
const MARK_MAIN = "--- opencode-go (bundled-catalog route) ---";
const MARK_COMPLETIONS = "--- opencode-go-completions route ---";
const MARK_RESPONSES = "--- opencode-go-responses route ---";
/** 断片は settings.yaml 内と同じインデント (8 spaces) のまま書かれているので、
 *  単体で parse できるよう共通インデントを剥がす。 */
function dedentAll(text) {
	const kept = text.split("\n").filter((l) => l.trim() !== "");
	const min = Math.min(...kept.map((l) => l.match(/^ */)[0].length));
	return kept.map((l) => l.slice(min)).join("\n");
}
const section = (start, end) => {
	const i = raw.indexOf(start);
	if (i < 0) throw new Error(`gen.mjs の出力に ${start} がありません`);
	const j = end === undefined ? raw.length : raw.indexOf(end, i);
	return dedentAll(raw.slice(i + start.length, j < 0 ? raw.length : j));
};
const mainArr = YAML.parse(section(MARK_MAIN, MARK_COMPLETIONS));
const complArr = YAML.parse(section(MARK_COMPLETIONS, MARK_RESPONSES));
const respArr = YAML.parse(section(MARK_RESPONSES));
console.log(`gen.mjs: main=${mainArr?.length ?? 0} completions=${complArr?.length ?? 0} responses=${respArr?.length ?? 0}`);

// ---- 2. settings.yaml を Document API で読む (コメント保持)
const settingsDoc = YAML.parseDocument(readFileSync(SETTINGS, "utf8"));
if (settingsDoc.errors.length > 0) {
	console.error("settings.yaml 解析エラー:", settingsDoc.errors[0].message);
	process.exit(1);
}
const providersPath = ["llm-pi-ai", "providers"];
const existingMain = settingsDoc.getIn([...providersPath, "opencode-go", "models"]);
if (existingMain === undefined || existingMain === null) {
	console.error("llm-pi-ai.providers.opencode-go が settings.yaml にありません (先に ~/.dsh/opencode-go-setup/apply.mjs を実行)");
	process.exit(1);
}
console.log(`models: 既存 ${existingMain.items?.length ?? 0} → 新 ${mainArr.length}`);

if (dryRun) {
	console.log("--- opencode-go-completions ---");
	console.log(YAML.stringify({ api: "openai-completions", baseURL: "https://opencode.ai/zen/go/v1", headers: { "x-opencode-session": "…" }, models: complArr }).trimEnd());
	console.log("--- opencode-go-responses ---");
	console.log(YAML.stringify({ api: "openai-responses", baseURL: "https://opencode.ai/zen/go/v1", headers: { "x-opencode-session": "…" }, models: respArr }).trimEnd());
	process.exit(0);
}

// ---- 3. backup (restore.sh 付き)
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = join(BACKUP_ROOT, `ocgo-models-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(SETTINGS, join(backupDir, "settings.yaml"));
chmodSync(join(backupDir, "settings.yaml"), 0o600);
writeFileSync(join(backupDir, "restore.sh"), `#!/bin/sh
cp "${join(backupDir, "settings.yaml")}" "${SETTINGS}"
echo "settings.yaml を ${stamp} の時点へ戻しました"
`);
chmodSync(join(backupDir, "restore.sh"), 0o700);
console.log(`backup: ${backupDir}`);

// ---- 4. 差し込む
const SESSION_HEADER = settingsDoc.getIn([...providersPath, "opencode-go", "headers"])?.toJSON?.() ?? {};
// Anthropic Messages は SDK が baseURL に /v1/messages を連結するため、
// OpenCode Go 側の実 endpoints (/zen/go/v1/messages) に合わせてここでは
// https://opencode.ai/zen/go を渡す (= /v1/messages が付いて正解になる)。
const newCompletions = { displayName: "OpenCode Go (new chat-completions models)", apiKeyEnv: "OPENCODE_GO_API_KEY", api: "openai-completions", baseURL: "https://opencode.ai/zen/go/v1", headers: { ...SESSION_HEADER }, models: complArr };
const newResponses = { displayName: "OpenCode Go (new responses models)", apiKeyEnv: "OPENCODE_GO_API_KEY", api: "openai-responses", baseURL: "https://opencode.ai/zen/go/v1", headers: { ...SESSION_HEADER }, models: respArr };

settingsDoc.setIn([...providersPath, "opencode-go", "models"], mainArr);
settingsDoc.setIn([...providersPath, "opencode-go-completions"], newCompletions);
settingsDoc.setIn([...providersPath, "opencode-go-responses"], newResponses);

const tmp = SETTINGS + ".tmp";
writeFileSync(tmp, settingsDoc.toString());
chmodSync(tmp, 0o600);
renameSync(tmp, SETTINGS);
console.log(`OK: settings.yaml 更新 (main ${mainArr.length} / completions ${complArr.length} / responses ${respArr.length})。DSH は live watch で即時拾います。`);
