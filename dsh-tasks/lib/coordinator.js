import {
	HUB_DESCRIPTION,
	Ledger,
	MAX_CONCURRENCY,
	PLUGIN,
	SlotPool,
	TASK_DESCRIPTION,
	assistantTextFromEvents,
	decideTool,
	deliverAfterLedger,
	denyNames,
	emptyLabel,
	livingStatus,
	MIL_REJECT,
	milSendable,
	prefixPeerText,
	projectView,
	routeSend,
	sha256,
	validateAssignment
} from "./core.js";

export { HUB_DESCRIPTION, TASK_DESCRIPTION, emptyLabel, projectView };

/**
 * One parent session's delegation state. Children stay addressable while the
 * job is open: running injects, waiting wakes, finished is gone. No revival.
 */
export class SessionTasks {
	/**
	 * @param {string} sessionId
	 * @param {{ ledger: Ledger, now?: () => number, pool?: SlotPool }} deps
	 */
	constructor(sessionId, deps) {
		this.sessionId = sessionId;
		this.ledger = deps.ledger;
		this.now = deps.now ?? Date.now;
		this.pool = deps.pool ?? new SlotPool(MAX_CONCURRENCY, this.now);
		this.enabled = false;
		/** @type {Map<string, ChildRecord>} */
		this.children = new Map();
		/** @type {string[]} */
		this.outputChunks = [];
	}

	/**
	 * @param {boolean} enabled
	 * @param {string} [promptSectionSha]
	 */
	setEnabled(enabled, promptSectionSha) {
		this.enabled = enabled === true;
		this.ledger.append({
			kind: "toggle",
			sessionId: this.sessionId,
			enabled: this.enabled,
			...promptSectionSha === undefined ? {} : { promptSectionSha }
		});
	}

	/**
	 * @param {ChildRecord} child
	 */
	add(child) {
		this.children.set(child.id, child);
	}

	/**
	 * @param {string} id
	 * @returns {ChildRecord | undefined}
	 */
	get(id) {
		return this.children.get(id);
	}

	roster() {
		return new Map([...this.children].map(([id, child]) => [id, child]));
	}

	/**
	 * @param {number} [now]
	 */
	view(now = this.now()) {
		return projectView({
			enabled: this.enabled,
			live: [...this.children.values()].filter((child) => child.addressable === true),
			records: this.ledger.records.filter((record) => record.sessionId === this.sessionId || record.parentSessionId === this.sessionId),
			now
		});
	}
}

/**
 * @typedef {object} ChildRecord
 * @property {string} id
 * @property {string} role
 * @property {string} label
 * @property {string} status
 * @property {boolean} addressable
 * @property {string | null} lastTool
 * @property {string | null} jobId
 * @property {number} startedAt
 * @property {number} [queueMs]
 * @property {string} output
 * @property {readonly string[]} paths
 * @property {string} cwd
 * @property {Array<(notice: { from: string }) => void>} waiters
 * @property {((outcome: { status: string, output: string, detail?: string }) => void) | null} finish
 * @property {Array<(text: string) => void>} [onOutput]
 */

/**
 * @param {SessionTasks} session
 * @param {{ fromId: string, toId?: string, text?: string }} input
 * @param {{ inject: (id: string, text: string) => void, followup: (id: string, text: string) => void }} ports
 * @returns {{ text: string }}
 */
export function sendSibling(session, input, ports) {
	const from = session.get(input.fromId);
	if (from === undefined) return { text: "gone" };
	const toId = typeof input.toId === "string" ? input.toId : "";
	const text = typeof input.text === "string" ? input.text : "";
	if (toId.length === 0 || text.trim().length === 0) return { text: "send requires to and text" };
	const decision = routeSend({ fromId: input.fromId, toId, roster: session.roster() });
	const record = {
		kind: "hub",
		sessionId: session.sessionId,
		parentSessionId: session.sessionId,
		from: input.fromId,
		fromRole: from.role,
		to: toId,
		text
	};
	if (decision.receipt === "gone") {
		session.ledger.append({ ...record, phase: "delivered", receipt: "gone" });
		return { text: "gone" };
	}
	if (!milSendable(text)) {
		session.ledger.append({ ...record, phase: "rejected", receipt: "rejected", reason: "not-mil" });
		return { text: MIL_REJECT };
	}
	const body = prefixPeerText(input.fromId, from.role, text);
	const delivered = deliverAfterLedger(session.ledger, record, () => {
		if (decision.receipt === "injected") ports.inject(toId, body);
		else ports.followup(toId, body);
		return { receipt: decision.receipt };
	});
	if (delivered.undelivered !== undefined) return { text: `undelivered: ${delivered.undelivered}` };
	const target = session.get(toId);
	if (target !== undefined) {
		for (const waiter of target.waiters.splice(0)) waiter({ from: input.fromId });
	}
	return { text: delivered.receipt };
}

/**
 * @param {SessionTasks} session
 * @param {string} selfId
 * @returns {{ text: string }}
 */
export function statusText(session, selfId) {
	const rows = livingStatus(selfId, session.children.values());
	if (rows.length === 0) return { text: "no living siblings" };
	return {
		text: rows.map((row) => `${row.id} ${row.role} ${row.status} ${row.label} last_tool=${row.last_tool ?? "none"} addressable=true`).join("\n")
	};
}

/**
 * Hold until a peer send resolves a waiter, or the signal aborts.
 * @param {ChildRecord} child
 * @param {AbortSignal} signal
 * @param {number} timeoutMs
 * @returns {Promise<{ text: string }>}
 */
export function waitForPeer(child, signal, timeoutMs) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (text) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			resolve({ text });
		};
		const onAbort = () => finish("aborted");
		const timer = setTimeout(() => finish("no peer message arrived"), timeoutMs);
		signal.addEventListener("abort", onAbort, { once: true });
		child.waiters.push(() => finish("a peer message was queued; it arrives as the next model-visible message"));
	});
}

/**
 * Apply one role guard. Denials are for the caller to log.
 * @param {ChildRecord} child
 * @param {string} name
 * @param {unknown} args
 * @returns {string | undefined}
 */
export function guardChild(child, name, args) {
	child.lastTool = name;
	const decision = decideTool(child.role, name, args, { paths: child.paths, cwd: child.cwd });
	if (decision.allow) return undefined;
	return decision.reason;
}

/**
 * @param {SessionTasks} session
 * @param {string} childId
 * @param {string} status
 * @param {readonly object[]} [events]
 */
export function noteStatus(session, childId, status, events = []) {
	const child = session.get(childId);
	if (child === undefined || child.addressable !== true) return;
	if (status === "running") {
		child.status = "running";
		session.ledger.append({ kind: "status", sessionId: session.sessionId, parentSessionId: session.sessionId, childId, status: "running" });
		return;
	}
	if (status === "idle") {
		child.status = "waiting";
		const text = assistantTextFromEvents(events);
		if (text.length > 0) child.output = text;
		session.ledger.append({ kind: "status", sessionId: session.sessionId, parentSessionId: session.sessionId, childId, status: "waiting" });
		return;
	}
}

/**
 * Mark a child finished. Later sends are gone. Does not revive.
 * @param {SessionTasks} session
 * @param {string} childId
 * @param {{ status: string, detail?: string }} outcome
 */
export function finishChild(session, childId, outcome) {
	const child = session.get(childId);
	if (child === undefined || child.status === "gone") return;
	child.status = "gone";
	child.addressable = false;
	session.ledger.append({
		kind: "end",
		sessionId: session.sessionId,
		parentSessionId: session.sessionId,
		childId,
		role: child.role,
		stopReason: outcome.status,
		...outcome.detail === undefined ? {} : { detail: outcome.detail }
	});
	if (child.finish !== null) {
		const finish = child.finish;
		child.finish = null;
		finish({ status: outcome.status, output: child.output, detail: outcome.detail });
	}
	for (const waiter of child.waiters.splice(0)) waiter({ from: "" });
}

/**
 * @param {SessionTasks} session
 * @param {{ role: string, description: string, prompt: string, paths?: readonly string[], cwd: string, roleText: string }} input
 * @returns {{ ok: true, child: ChildRecord, persona: string, roleSha: string, deny: string[] } | { ok: false, reason: string }}
 */
export function prepareLaunch(session, input, presentTools = []) {
	const checked = validateAssignment(input);
	if (!checked.ok) {
		session.ledger.append({
			kind: "reject",
			sessionId: session.sessionId,
			parentSessionId: session.sessionId,
			role: input.role,
			reason: checked.reason
		});
		return checked;
	}
	const roleSha = sha256(input.roleText);
	const child = {
		id: "",
		role: checked.role,
		label: input.description.trim(),
		status: "queued",
		addressable: false,
		lastTool: null,
		jobId: null,
		startedAt: session.now(),
		output: "",
		paths: checked.paths,
		cwd: input.cwd,
		waiters: [],
		finish: null
	};
	return {
		ok: true,
		child,
		persona: input.roleText,
		roleSha,
		prompt: input.prompt.trim(),
		deny: denyNames(checked.role, presentTools)
	};
}

/**
 * @param {SessionTasks} session
 * @param {ChildRecord} child
 * @param {{ roleSha: string, prompt: string, model?: string }} meta
 */
export function noteSpawn(session, child, meta) {
	session.add(child);
	session.ledger.append({
		kind: "spawn",
		sessionId: session.sessionId,
		parentSessionId: session.sessionId,
		childId: child.id,
		role: child.role,
		label: child.label,
		jobId: child.jobId,
		roleSha: meta.roleSha,
		prompt: meta.prompt,
		...meta.model === undefined ? {} : { model: meta.model },
		...child.queueMs === undefined ? {} : { queueMs: child.queueMs }
	});
}

export const PROMPT_SECTION_SHA = sha256(TASK_DESCRIPTION);

export function pluginSource(summary) {
	return { kind: "plugin", plugin: PLUGIN, form: "notice", summary };
}

void HUB_DESCRIPTION;
