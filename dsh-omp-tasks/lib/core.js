import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

/** Closed role set. A fifth role is a rejection, not a fallback. */
export const ROLES = Object.freeze(["explorer", "worker", "reviewer", "hacker"]);

/** Live children that hold a slot. Queued jobs do not. */
export const MAX_CONCURRENCY = 4;

export const PLUGIN = "dsh-omp-tasks";

/** Model-facing receipts. There is no fourth, and no retry. */
export const RECEIPTS = Object.freeze(["injected", "woken", "gone"]);

export const WEB_PREFIX = "mcp__web__";
export const KG_PREFIX = "mcp__knowledge-graph__";

const WRITE_TOOLS = new Set(["write", "edit"]);
const READ_TOOLS = new Set(["read", "grep", "glob", "read_image"]);

const SHELL_WRITE = /\b(tee|rm|mv|cp|mkdir|chmod|chown|truncate|unlink|install|dd)\b|\bsed\s+[^\n]*\s-i\b|\bgit\s+(commit|push|add|reset|checkout|clean)\b|(?:^|[\s;|&])>{1,2}\s*\S/;
const GPU_CONTROL = /systemctl\s+(?:start|stop|restart|enable|disable)\b|nvidia-smi\b[^\n]*-pm\b|docker\s+[^\n]*--gpus\b|\bvllm\s+serve\b|\bcuda-gdb\b/i;

/**
 * @param {string} role
 * @returns {boolean}
 */
export function isRole(role) {
	return ROLES.includes(role);
}

/**
 * Refuse a launch that cannot name its verb. Worker without paths never starts.
 * @param {{ role?: string, prompt?: string, description?: string, paths?: readonly string[] }} input
 * @returns {{ ok: true, role: string, paths: string[] } | { ok: false, reason: string }}
 */
export function validateAssignment(input) {
	const role = input?.role;
	if (!isRole(role)) return { ok: false, reason: `role must be one of ${ROLES.join(", ")}` };
	const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
	if (prompt.length === 0) return { ok: false, reason: "prompt must be non-empty" };
	const description = typeof input.description === "string" ? input.description.trim() : "";
	if (description.length === 0) return { ok: false, reason: "description must be non-empty" };
	const paths = Array.isArray(input.paths) ? input.paths.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
	if (role === "worker" && paths.length === 0) return { ok: false, reason: "worker requires at least one path; the launch was refused" };
	if (!milSendable(prompt)) return { ok: false, reason: MIL_REASON };
	return { ok: true, role, paths };
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * @param {string} target
 * @param {readonly string[]} assigned
 * @param {string} cwd
 * @returns {boolean}
 */
export function pathAllowed(target, assigned, cwd) {
	if (typeof target !== "string" || target.length === 0 || !Array.isArray(assigned) || assigned.length === 0) return false;
	const root = resolve(cwd);
	const resolved = resolve(root, target);
	return assigned.some((item) => {
		const base = resolve(root, item);
		if (resolved === base) return true;
		const rel = relative(base, resolved);
		return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
	});
}

/**
 * Best-effort write detection. A miss is a logged gap, not a claim of safety.
 * @param {string} command
 * @returns {boolean}
 */
export function shellWriteLikely(command) {
	return typeof command === "string" && SHELL_WRITE.test(command);
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function gpuControlLikely(command) {
	return typeof command === "string" && GPU_CONTROL.test(command);
}

/**
 * Global tool names a role must not see, when those names exist.
 * Unknown names are not included: restrict() rejects them.
 * @param {string} role
 * @param {readonly string[]} present
 * @returns {string[]}
 */
export function denyNames(role, present) {
	const known = new Set(present);
	const wanted = ["ask_user_question", "task", "write", "edit"];
	if (role === "reviewer") wanted.push("bash");
	if (role !== "explorer") {
		for (const name of present) if (name.startsWith(WEB_PREFIX)) wanted.push(name);
	}
	if (role === "worker" || role === "reviewer") {
		for (const name of present) if (name.startsWith(KG_PREFIX)) wanted.push(name);
	}
	return [...new Set(wanted)].filter((name) => known.has(name));
}

/**
 * @param {string} role
 * @param {string} name
 * @param {unknown} args
 * @param {{ paths: readonly string[], cwd: string }} scope
 * @returns {{ allow: true } | { allow: false, reason: string, log: boolean }}
 */
export function decideTool(role, name, args, scope) {
	if (!isRole(role)) return { allow: false, reason: "unknown role", log: true };
	if (name === "ask_user_question" || name === "task") return { allow: false, reason: `${name} is not available to a subagent`, log: true };
	if (name.startsWith(WEB_PREFIX) && role !== "explorer") return { allow: false, reason: "web tools are explorer-only", log: true };
	if (name.startsWith(KG_PREFIX) && (role === "worker" || role === "reviewer")) return { allow: false, reason: "knowledge-graph tools are not on this role", log: true };
	if (WRITE_TOOLS.has(name)) {
		if (role !== "worker") return { allow: false, reason: `${role} cannot ${name}`, log: true };
		const target = toolPath(args);
		if (!pathAllowed(target, scope.paths, scope.cwd)) return { allow: false, reason: `${name} path is outside the assignment`, log: true };
		return { allow: true };
	}
	if (name === "bash") {
		if (role === "reviewer") return { allow: false, reason: "reviewer cannot run bash", log: true };
		const command = typeof args === "object" && args !== null && typeof args.command === "string" ? args.command : "";
		if (gpuControlLikely(command)) return { allow: false, reason: "GPU start or stop is refused", log: true };
		if (shellWriteLikely(command)) {
			if (role !== "worker") return { allow: false, reason: "shell write was refused and logged", log: true };
			if (!commandMentionsAssigned(command, scope.paths, scope.cwd)) return { allow: false, reason: "shell write is outside the assignment", log: true };
		}
		return { allow: true };
	}
	if (READ_TOOLS.has(name) || name === "hub" || name.startsWith("mcp__") || name === "job_output" || name === "job_list" || name === "job_kill") return { allow: true };
	return { allow: true };
}

/**
 * @param {unknown} args
 * @returns {string}
 */
function toolPath(args) {
	if (typeof args !== "object" || args === null) return "";
	const record = /** @type {Record<string, unknown>} */ (args);
	for (const key of ["path", "file_path", "filePath"]) {
		if (typeof record[key] === "string") return record[key];
	}
	return "";
}

/**
 * @param {string} command
 * @param {readonly string[]} assigned
 * @param {string} cwd
 * @returns {boolean}
 */
function commandMentionsAssigned(command, assigned, cwd) {
	return assigned.some((item) => {
		const abs = resolve(cwd, item);
		return command.includes(item) || command.includes(abs);
	});
}

/**
 * Route one sibling send. Finished, self, and unknown ids are gone. No retry.
 * @param {{ fromId: string, toId: string, roster: ReadonlyMap<string, { status: string, addressable?: boolean }> }} input
 * @returns {{ receipt: "injected" | "woken" | "gone" }}
 */
export function routeSend(input) {
	if (input.fromId === input.toId) return { receipt: "gone" };
	const target = input.roster.get(input.toId);
	if (target === undefined || target.addressable !== true) return { receipt: "gone" };
	if (target.status === "running") return { receipt: "injected" };
	if (target.status === "waiting") return { receipt: "woken" };
	return { receipt: "gone" };
}

/**
 * Author's public norm line. CC0. Not an example, and not a parser.
 * https://x.com/AM09_21/status/2103233036817170460
 */
export const MIL_NORM = "MiL;C(m):=argmin_tok{s:⟦s⟧=m};R:=sym>logic>abbr>alias>>>EN;del(recoverable);IF:=cond;@:=ext;¬infer;amb→qmin";

/** Shared reject reason. Callers add their own "rejected:" prefix when they have one. */
export const MIL_REASON = "text must be MiL; need a clause mark outside quotes: := ; → ⇒ ∴ ∵ ¬ ∧ ∨";

/** Not gone. The sender rewrites once. A dead peer is still gone, even if the text is prose. */
export const MIL_REJECT = `rejected: ${MIL_REASON}`;

const MIL_MARK = /:=|;|→|⇒|∴|∵|¬|∧|∨/;

/**
 * Drop a copied norm. The host prefixes it. Do not rewrite the rest.
 * @param {string} text
 * @returns {string}
 */
export function milBody(text) {
	let body = text.trim();
	while (body.startsWith(MIL_NORM)) body = body.slice(MIL_NORM.length).trim();
	return body;
}

/**
 * Delivery gate, not a grammar. Prose without a clause mark does not ride the channel.
 * Quoted payloads are ignored. A colon alone is not enough.
 * @param {string} text
 * @returns {boolean}
 */
export function milSendable(text) {
	const body = milBody(text);
	if (body.length === 0) return false;
	const outside = body.replace(/"(?:\\.|[^"\\])*"/g, "");
	return MIL_MARK.test(outside);
}

/**
 * Norm, then the envelope, then the sender's m. The envelope is not m.
 * @param {string} fromId
 * @param {string} role
 * @param {string} text
 * @returns {string}
 */
export function prefixPeerText(fromId, role, text) {
	return `${MIL_NORM}\n\nenv:from={${milToken(fromId)},${role}}; m@after; ¬infer\n\n${milBody(text)}`;
}

/**
 * Parent-visible report. Prose is not forwarded; the raw text stays in the child log.
 * @param {string} text
 * @returns {string}
 */
export function reportBody(text) {
	if (typeof text !== "string" || text.trim().length === 0) return "report:=∅";
	if (!milSendable(text)) return "report:=∅ ∵ ¬MiL";
	return milBody(text);
}

/**
 * @param {string} fromId
 * @param {string} role
 * @param {string} text
 * @returns {string}
 */
export function prefixReportText(fromId, role, text) {
	return `${MIL_NORM}\n\nenv:from={${milToken(fromId)},${role}}; m@after; ¬infer\n\n${reportBody(text)}`;
}

/**
 * One host notice to the parent. Japanese is not used here.
 * @param {string} jobId
 * @param {string} role
 * @param {string} label
 * @param {string} output
 * @param {string} status
 * @returns {string}
 */
export function parentNotice(jobId, role, label, output, status) {
	const state = typeof status === "string" && /^[A-Za-z0-9_-]+$/.test(status) ? status : "unknown";
	return `${MIL_NORM}\n\nenv:from={${milToken(jobId)},${role}}; status:=${state}; label:=${JSON.stringify(String(label ?? ""))}; m@after; ¬infer\n\n${reportBody(output)}`;
}

/**
 * Assignment the child receives. Paths are the harness scope, not an inference.
 * @param {string} prompt
 * @param {readonly string[]} paths
 * @returns {string}
 */
export function assignmentText(prompt, paths) {
	const body = milBody(typeof prompt === "string" ? prompt : "");
	const listed = Array.isArray(paths) ? paths.filter((item) => typeof item === "string" && item.length > 0) : [];
	const m = listed.length > 0 ? `${body}; paths:={${listed.map((item) => JSON.stringify(item)).join(",")}}` : body;
	return `${MIL_NORM}\n\nenv:from=parent; m@after; ¬infer\n\n${m}`;
}

/**
 * First prose report gets one rewrite ask. A second prose report is not nudged again.
 * @param {string} text
 * @param {boolean | undefined} nudged
 * @returns {boolean}
 */
export function needsReportNudge(text, nudged) {
	return typeof text === "string" && text.trim().length > 0 && !milSendable(text) && nudged !== true;
}

/** Injected once when a child reports in prose. */
export const MIL_REPORT_NUDGE = `${MIL_NORM}\n\nenv:from=host; m@after; ¬infer\n\nreport:=∅ ∵ ¬MiL; next:restate(MiL); ¬prose; ¬infer`;

/**
 * Roster notice. Not a sibling send.
 * @param {string} childId
 * @param {string} role
 * @returns {string}
 */
export function rosterNotice(childId, role) {
	return `${MIL_NORM}\n\nenv:from=host; m@after; ¬infer\n\nid:=${milToken(childId)}; role:=${role}; chan:hub; ¬spawn; ¬invent(id)`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function milToken(value) {
	const text = String(value ?? "");
	return /^[A-Za-z0-9_-]+$/.test(text) ? text : JSON.stringify(text);
}

/**
 * Status lines for living siblings only. No invented names, no self, no gone.
 * @param {string} selfId
 * @param {Iterable<{ id: string, role: string, status: string, label: string, lastTool?: string, addressable: boolean }>} children
 * @returns {Array<{ id: string, role: string, status: string, label: string, last_tool: string | null, addressable: true }>}
 */
export function livingStatus(selfId, children) {
	const rows = [];
	for (const child of children) {
		if (child.id === selfId) continue;
		if (child.addressable !== true) continue;
		if (child.status !== "running" && child.status !== "waiting") continue;
		rows.push({
			id: child.id,
			role: child.role,
			status: child.status,
			label: child.label,
			last_tool: typeof child.lastTool === "string" && child.lastTool.length > 0 ? child.lastTool : null,
			addressable: true
		});
	}
	rows.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
	return rows;
}

/**
 * @param {readonly { type?: string, data?: { message?: { content?: unknown }, content?: unknown } }[]} events
 * @returns {string}
 */
export function assistantTextFromEvents(events) {
	let text = "";
	for (const event of events) {
		if (event?.type !== "assistant/message") continue;
		const content = event.data?.message?.content ?? event.data?.content;
		if (!Array.isArray(content)) continue;
		const piece = content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
		if (piece.length > 0) text = piece;
	}
	return text;
}

/**
 * Slot gate. The fifth acquire waits; queueMs is measured only after release.
 */
export class SlotPool {
	/**
	 * @param {number} [max]
	 * @param {() => number} [now]
	 */
	constructor(max = MAX_CONCURRENCY, now = Date.now) {
		this.max = max;
		this.now = now;
		this.active = 0;
		/** @type {Array<{ resolve: (slot: { queueMs: number, release: () => void }) => void, reject: (error: Error) => void, signal: AbortSignal, started: number }>} */
		this.waiting = [];
	}

	/**
	 * @param {AbortSignal} signal
	 * @returns {Promise<{ queueMs: number, release: () => void }>}
	 */
	acquire(signal) {
		const started = this.now();
		if (signal.aborted) return Promise.reject(abortError(signal));
		if (this.active < this.max) {
			this.active += 1;
			return Promise.resolve({ queueMs: 0, release: () => this.release() });
		}
		return new Promise((resolve, reject) => {
			const entry = { resolve, reject, signal, started };
			const onAbort = () => {
				const at = this.waiting.indexOf(entry);
				if (at !== -1) this.waiting.splice(at, 1);
				reject(abortError(signal));
			};
			entry.onAbort = onAbort;
			signal.addEventListener("abort", onAbort, { once: true });
			this.waiting.push(entry);
		});
	}

	release() {
		const next = this.waiting.shift();
		if (next === undefined) {
			this.active = Math.max(0, this.active - 1);
			return;
		}
		next.signal.removeEventListener("abort", next.onAbort);
		const queueMs = Math.max(0, this.now() - next.started);
		next.resolve({ queueMs, release: () => this.release() });
	}
}

/**
 * @param {AbortSignal} signal
 * @returns {Error}
 */
function abortError(signal) {
	const error = new Error("aborted");
	error.name = "AbortError";
	if (signal.reason !== undefined) error.cause = signal.reason;
	return error;
}

/**
 * Append-only ledger. A toggle never truncates it.
 */
export class Ledger {
	/**
	 * @param {{ append: (line: string) => void, now?: () => number }} io
	 */
	constructor(io) {
		this.appendLine = io.append;
		this.now = io.now ?? Date.now;
		/** @type {object[]} */
		this.records = [];
	}

	/**
	 * @param {Record<string, unknown>} record
	 * @returns {Record<string, unknown>}
	 */
	append(record) {
		const line = { time: this.now(), plugin: PLUGIN, ...record };
		this.records.push(line);
		this.appendLine(`${JSON.stringify(line)}\n`);
		return line;
	}
}

/**
 * Write the send text before the delivery callback runs.
 * @param {Ledger} ledger
 * @param {Record<string, unknown>} record
 * @param {() => { receipt: string }} deliver
 * @returns {{ receipt: string, undelivered?: string }}
 */
export function deliverAfterLedger(ledger, record, deliver) {
	ledger.append({ ...record, phase: "accepted" });
	try {
		const result = deliver();
		ledger.append({ ...record, phase: "delivered", receipt: result.receipt });
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ledger.append({ ...record, phase: "undelivered", error: message });
		return { receipt: "gone", undelivered: message };
	}
}

/**
 * Tab projection. Missing times stay absent. Off does not drop history.
 * @param {{ enabled: boolean, live: readonly object[], records: readonly Record<string, unknown>[], now?: number }} input
 * @returns {{ enabled: boolean, empty: "off" | "none" | null, live: object[], history: object[], hub: object[] }}
 */
export function projectView(input) {
	const history = [];
	const hub = [];
	for (const record of input.records) {
		if (record.kind === "hub") hub.push(record);
		else if (record.kind === "spawn" || record.kind === "end" || record.kind === "reject" || record.kind === "status") history.push(record);
	}
	const live = input.live.map((row) => publicLive(row, input.now));
	let empty = null;
	if (input.enabled !== true) empty = "off";
	else if (live.length === 0 && history.length === 0 && hub.length === 0) empty = "none";
	return {
		enabled: input.enabled === true,
		empty,
		live,
		history,
		hub,
		subModel: parseSubModel(input.subModel)
	};
}

/**
 * A stored child route. Null means the child inherits the parent route.
 * @param {unknown} value
 * @returns {{ provider: string, model: string } | null}
 */
export function parseSubModel(value) {
	if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return null;
	const provider = value.provider;
	const model = value.model;
	if (!routeToken(provider) || !routeToken(model)) return null;
	return { provider, model };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function routeToken(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\0\r\n/\\]/.test(value);
}

/**
 * @param {unknown} parsed
 * @returns {{ enabled: boolean, subModel: { provider: string, model: string } | null }}
 */
export function readSessionState(parsed) {
	return {
		enabled: parsed?.enabled === true,
		subModel: parseSubModel(parsed?.subModel)
	};
}

/**
 * Merge one field. A toggle must not wipe the child route, and a route write must not wipe the toggle.
 * @param {unknown} previous
 * @param {{ enabled?: boolean, subModel?: { provider: string, model: string } | null }} patch
 * @returns {{ enabled: boolean, subModel: { provider: string, model: string } | null }}
 */
export function writeSessionDocument(previous, patch) {
	const base = readSessionState(previous);
	const enabled = patch.enabled === undefined ? base.enabled : patch.enabled === true;
	const subModel = Object.prototype.hasOwnProperty.call(patch, "subModel") ? parseSubModel(patch.subModel) : base.subModel;
	return { enabled, subModel };
}

/**
 * Child override. Effort is omitted so a different route uses that model's own default.
 * @param {unknown} route
 * @returns {{ provider: string, model: string } | undefined}
 */
export function childAgentOptions(route) {
	const parsed = parseSubModel(route);
	if (parsed === null) return undefined;
	return { provider: parsed.provider, model: parsed.model };
}

/**
 * The sub menu exists only while this session's subagents are on.
 * @param {boolean | undefined} enabled
 * @returns {boolean}
 */
export function subMenuVisible(enabled) {
	return enabled === true;
}

/**
 * @param {Record<string, unknown>} row
 * @param {number | undefined} now
 * @returns {object}
 */
function publicLive(row, now) {
	const out = {
		id: row.id,
		role: row.role,
		status: row.status,
		label: row.label,
		lastTool: row.lastTool ?? null,
		addressable: row.addressable === true,
		jobId: row.jobId ?? null
	};
	if (typeof row.startedAt === "number" && typeof now === "number") out.elapsedMs = Math.max(0, now - row.startedAt);
	return out;
}

/**
 * A persisted on wins over an in-memory off. Off is written to the file too,
 * so a true file means this process missed the restore, not that the user
 * turned it off.
 * @param {boolean | undefined} memoryEnabled
 * @param {boolean} fileEnabled
 * @returns {boolean}
 */
export function resolveEnabled(memoryEnabled, fileEnabled) {
	return memoryEnabled === true || fileEnabled === true;
}

/**
 * @param {"off" | "none" | "loading" | "unread" | null} empty
 * @returns {string | null}
 */
export const USAGE = "usage: /subagents on|off|status";

export function emptyLabel(empty) {
	if (empty === "off" || empty === "none") return USAGE;
	return null;
}

/**
 * Absolute depth cap passed to startContinuable.
 * DSH sets child depth to parent depth + 1 and rejects when that exceeds maxDepth.
 * 0 rejects the first child (depth 1). 1 allows one level. A grandchild that reuses this cap is depth 2 and is rejected.
 */
export const CHILD_MAX_DEPTH = 1;

/** Parent tool text. The complete persona drops extra prompt sections, so the schema carries the rules. */
export const TASK_DESCRIPTION = [
	"Delegate one self-contained assignment to a fresh child that does not see this conversation.",
	"Roles are exclusive: explorer measures files, worker edits only the paths you name, reviewer judges the assigned diff and does not edit, hacker attacks premises and does not edit.",
	"You are the only agent that may spawn. Do not spawn a second child for the same assignment. Children cannot spawn.",
	"run_in_background defaults to true. Start independent delegations together and keep working. Set it false only when your next action needs that result.",
	"Collect with job_output, stop with job_kill. A waiting child can still receive sibling messages until you kill the job.",
	"Speak Japanese only to the user. Do not speak Japanese to a child.",
	`task prompt is MiL, not prose. Do not repeat this norm: ${MIL_NORM}`,
	"Before encode, fix m. State relation, scope, cond, priority. Delete what the child can restore. A second reading becomes qmin. Do not add an unwritten reason. Natural language only inside quotes.",
	"Child reports and sibling hub messages are MiL. The host prefixes the norm. Line 1 is the norm, not m. env is not m. Do not infer past the clauses. Translate to Japanese only when you answer the user.",
	"A non-MiL prompt is rejected, not started; rewrite once.",
	"Worker without paths is refused and does not start.",
	"Do not start or stop GPU workloads from a child. Do not ask a child to call ask_user_question."
].join(" ");

export const HUB_DESCRIPTION = [
	"Sibling channel for this live overlap only.",
	"status lists living siblings: id, role, running or waiting, label, last tool name. It does not list you, finished ids, or invented names.",
	`send text is MiL, not prose. Do not repeat this norm in text: ${MIL_NORM}`,
	"Before encode, fix m. State relation, scope, cond, priority. Delete what the receiver can restore. A second reading becomes qmin. Do not add an unwritten reason. Natural language only inside quotes.",
	"kind:=fact|measure|finding|premise|blocker|qmin. loc:=path:line. from is a roster id from status, not a name.",
	"The host prefixes the norm and env:from={id,role}; m@after; ¬infer. On receive, line 1 is the norm, not m. env is not m. Do not infer past the sender's clauses. A second reading stays qmin.",
	"Receipts are injected, woken, or gone. gone is final; do not retry and do not wake a finished sibling. A non-MiL send is rejected, not gone; rewrite once.",
	"wait only when you are blocked on a sibling. Do not use it to poll status.",
	"You cannot spawn, broadcast, or order another role to implement."
].join(" ");

/**
 * @param {string} role
 * @returns {string}
 */
export function parentSectionText() {
	return TASK_DESCRIPTION;
}
