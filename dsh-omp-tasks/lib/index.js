import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boundContextSummary, createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
	HUB_DESCRIPTION,
	KG_PREFIX,
	Ledger,
	PLUGIN,
	SlotPool,
	CHILD_MAX_DEPTH,
	MIL_REPORT_NUDGE,
	TASK_DESCRIPTION,
	assignmentText,
	needsReportNudge,
	parentNotice,
	prefixReportText,
	rosterNotice,
	WEB_PREFIX,
	childAgentOptions,
	readSessionState,
	resolveEnabled,
	writeSessionDocument
} from "./core.js";
import {
	PROMPT_SECTION_SHA,
	SessionTasks,
	finishChild,
	guardChild,
	noteSpawn,
	noteStatus,
	prepareLaunch,
	projectView,
	sendSibling,
	statusText,
	waitForPeer
} from "./coordinator.js";

const watched = new WeakSet();
const name = "omp-tasks";
const inject = ["agents", "commands", "subagents", "tools", "systemPrompt"];
const TEXT = { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } };
const USAGE = "usage: /subagents on|off|status";
const WAIT_DEFAULT_MS = 60_000;
const WAIT_MAX_MS = 300_000;
const KNOWN_TOOLS = [
	"ask_user_question",
	"task",
	"write",
	"edit",
	"bash",
	"read",
	"grep",
	"glob",
	"read_image",
	`${WEB_PREFIX}web_search`,
	`${WEB_PREFIX}web_fetch`,
	`${KG_PREFIX}kg_search`,
	`${KG_PREFIX}kg_get`,
	`${KG_PREFIX}kg_get_compact`,
	`${KG_PREFIX}kg_get_canonical`,
	`${KG_PREFIX}kg_index`,
	`${KG_PREFIX}kg_map`,
	`${KG_PREFIX}kg_neighbors`,
	`${KG_PREFIX}kg_doctor`
];

/**
 * Host half. Children are official continuable spawn agents. This plugin does
 * not start a second runtime and does not mount the official subagent tool.
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
function apply(ctx) {
	const home = ompHome();
	const ledger = openLedger(home);
	const pool = new SlotPool();
	/** @type {Map<string, SessionTasks>} */
	const sessions = new Map();
	/** @type {Map<object, () => void>} */
	const parentTools = new Map();
	/** @type {Map<string, Array<{ resolve: (info: { id: string }) => void, settled: boolean }>>} */
	const expects = new Map();

	const sessionFor = (agent) => {
		let session = sessions.get(agent.id);
		if (session === undefined) {
			session = new SessionTasks(agent.id, { ledger, pool });
			const stored = readSession(home, agent.id);
			session.enabled = stored.enabled;
			session.subModel = stored.subModel;
			sessions.set(agent.id, session);
		}
		return session;
	};

	const safeRegister = (label, fn) => {
		try {
			return fn();
		} catch (error) {
			ctx.logger?.warn?.(`[omp-tasks] ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	};

	safeRegister("command", () => ctx.commands.register({
		name: "subagents",
		description: USAGE,
		input: { hint: "on|off|status" },
		handler: ({ agent, rawInput }) => handleCommand(ctx, agent, rawInput, sessionFor, home, parentTools, expects)
	}));
	safeRegister("tasks-alias", () => ctx.commands.register({
		name: "tasks",
		description: USAGE,
		input: { hint: "on|off|status" },
		handler: ({ agent, rawInput }) => handleCommand(ctx, agent, rawInput, sessionFor, home, parentTools, expects)
	}));
	safeRegister("task-alias", () => ctx.commands.register({
		name: "task",
		description: USAGE,
		handler: () => ({ kind: "error", text: USAGE })
	}));

	ctx.on("agent/created", ({ agent }) => {
		if (!isRoot(ctx, agent)) return;
		const session = sessionFor(agent);
		watchParent(ctx, agent, expects);
		if (session.enabled) installParent(ctx, agent, session, parentTools, expects);
	});

	ctx.inject(["webServer", "connection"], (routeCtx) => {
		const route = {
			kind: "exact",
			path: "/api/omp-tasks/view",
			handler: async (req, res) => {
				const rejection = routeCtx.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.writeHead(rejection);
					res.end(rejection === 401 ? "unauthorized" : "forbidden");
					return;
				}
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				const sessionId = url.searchParams.get("session");
				if (sessionId === null || !safeSessionId(sessionId)) {
					json(res, 400, { error: "session required" });
					return;
				}
				const agent = ctx.agents?.get?.(sessionId);
				if (agent !== undefined && isRoot(ctx, agent)) {
					const live = sessionFor(agent);
					if (readSession(home, sessionId).enabled && live.enabled !== true) {
						live.enabled = true;
						watchParent(ctx, agent, expects);
						installParent(ctx, agent, live, parentTools, expects);
					}
				}
				json(res, 200, viewPayload(home, sessions, sessionId));
			}
		};
		const subModelRoute = {
			kind: "exact",
			path: "/api/omp-tasks/sub-model",
			handler: async (req, res) => {
				const rejection = routeCtx.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.writeHead(rejection);
					res.end(rejection === 401 ? "unauthorized" : "forbidden");
					return;
				}
				if (req.method !== "POST") {
					json(res, 405, { error: "POST required" });
					return;
				}
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				const sessionId = url.searchParams.get("session");
				if (sessionId === null || !safeSessionId(sessionId)) {
					json(res, 400, { error: "session required" });
					return;
				}
				const clear = url.searchParams.get("clear") === "1";
				const provider = url.searchParams.get("provider");
				const model = url.searchParams.get("model");
				const route = clear ? null : { provider, model };
				if (!clear && childAgentOptions(route) === undefined) {
					json(res, 400, { error: "provider and model required" });
					return;
				}
				const written = writeSession(home, sessionId, { subModel: clear ? null : route });
				const live = sessions.get(sessionId);
				if (live !== undefined) {
					live.subModel = written.subModel;
					live.ledger.append({
						kind: "sub-model",
						sessionId,
						parentSessionId: sessionId,
						...written.subModel === null ? { cleared: true } : written.subModel
					});
				}
				json(res, 200, viewPayload(home, sessions, sessionId));
			}
		};
		routeCtx.effect(() => routeCtx.webServer.register(route), "omp-tasks.view");
		routeCtx.effect(() => routeCtx.webServer.register(subModelRoute), "omp-tasks.sub-model");
	});
}

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{ id: string, ctx: import("@deepseek-ai/cordis").Context, status?: string, inject?: Function, followup?: Function }} agent
 */
function isRoot(ctx, agent) {
	try {
		return ctx.agents.roots().includes(agent);
	} catch {
		return false;
	}
}

function handleCommand(ctx, agent, rawInput, sessionFor, home, parentTools, expects) {
	if (!isRoot(ctx, agent)) return { kind: "error", text: `/subagents is only available on the parent session.\n${USAGE}` };
	const session = sessionFor(agent);
	const arg = String(rawInput ?? "").trim();
	if (arg === "on") {
		session.setEnabled(true, PROMPT_SECTION_SHA);
		writeSession(home, agent.id, { enabled: true });
		watchParent(ctx, agent, expects);
		installParent(ctx, agent, session, parentTools, expects);
		return { kind: "success", text: "subagents on. The task tool appears on the next request." };
	}
	if (arg === "off") {
		session.setEnabled(false, PROMPT_SECTION_SHA);
		writeSession(home, agent.id, { enabled: false });
		removeParent(agent, parentTools);
		return { kind: "success", text: "subagents off. Running children were left alive. Logs were kept." };
	}
	if (arg === "status") {
		const living = [...session.children.values()].filter((child) => child.addressable).length;
		return { kind: "success", text: `subagents ${session.enabled ? "on" : "off"}; living children ${living}` };
	}
	return { kind: "error", text: USAGE };
}

function watchParent(ctx, parent, expects) {
	if (watched.has(parent)) return;
	watched.add(parent);
	parent.ctx.on("subagent/start", (info) => {
		const list = expects.get(parent.id);
		const entry = list?.find((item) => item.settled !== true);
		if (entry === undefined) return;
		entry.settled = true;
		try {
			entry.onPublished?.(info);
		} catch (error) {
			entry.error = error;
		}
		entry.resolve(info);
	});
}

function installParent(ctx, agent, session, parentTools, expects) {
	if (parentTools.has(agent)) return;
	const disposers = [];
	const tool = taskTool(ctx, agent, session, expects);
	disposers.push(agent.ctx.tools.register(tool));
	try {
		const order = typeof agent.ctx.systemPrompt?.getSectionOrder === "function" ? agent.ctx.systemPrompt.getSectionOrder("TOOL_SUBAGENT") + 1 : 900;
		disposers.push(agent.ctx.systemPrompt.section({ name: "tool:task", order, text: TASK_DESCRIPTION }));
	} catch {
		// A complete persona drops extra sections. The tool description still carries the rules.
	}
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const stop of disposers.reverse()) {
			try { stop(); } catch { /* already gone */ }
		}
		parentTools.delete(agent);
	};
	parentTools.set(agent, dispose);
	agent.ctx.effect(() => dispose, "omp-tasks.parent-tools");
}

function removeParent(agent, parentTools) {
	const dispose = parentTools.get(agent);
	if (dispose !== undefined) dispose();
}

function taskTool(ctx, parent, session, expects) {
	return defineTool({
		name: "task",
		description: TASK_DESCRIPTION,
		parameters: {
			role: { type: "string", required: true, enum: ["explorer", "worker", "reviewer", "hacker"], description: "Exclusive verb." },
			description: { type: "string", required: true, description: "Short label." },
			prompt: { type: "string", required: true, description: "MiL assignment. The child does not see this conversation. No prose. Do not repeat the norm line." },
			paths: { type: "array", items: { type: "string" }, description: "Required for worker. The only paths that worker may edit." },
			run_in_background: { type: "boolean", description: "Default true. Set false only when the next action needs the result." }
		},
		output: { schema: TEXT, render: (_args, value) => [{ type: "text", text: value.text }] },
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			if (exec.agent !== parent || !isRoot(ctx, parent)) return { text: "rejected: only the root parent may spawn" };
			if (session.enabled !== true) return { text: `rejected: subagents are off\n${USAGE}` };
			const roleText = readRole(args.role);
			const prepared = prepareLaunch(session, {
				role: args.role,
				description: args.description,
				prompt: args.prompt,
				paths: args.paths,
				cwd: parent.session?.cwd ?? process.cwd(),
				roleText
			}, presentTools(ctx));
			if (!prepared.ok) return { text: `rejected: ${prepared.reason}` };
			snapshotRole(ompHome(), prepared.child.role, roleText, prepared.roleSha);
			const background = args.run_in_background !== false;
			const jobId = startJob(ctx, parent, session, prepared, expects, exec.signal);
			if (!background) {
				const outcome = await firstResult(prepared.child, exec.signal);
				return { text: outcome };
			}
			return { text: `started subagent job ${jobId}` };
		}
	});
}

function startJob(ctx, parent, session, prepared, expects, callerSignal) {
	const jobs = ctx.get?.("jobs") ?? ctx.jobs;
	if (jobs === undefined || typeof jobs.start !== "function") throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs");
	const child = prepared.child;
	const finished = new Promise((resolve) => { child.finish = resolve; });
	let entered = false;
	const spec = {
		label: child.label,
		owner: parent,
		run() {
			if (entered) throw new Error("subagent starter was entered twice");
			entered = true;
			const controller = new AbortController();
			const onCallerAbort = () => controller.abort(callerSignal.reason);
			if (callerSignal.aborted) controller.abort(callerSignal.reason);
			else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
			let release = () => {};
			const done = (async () => {
				const slot = await session.pool.acquire(controller.signal);
				release = slot.release;
				child.queueMs = slot.queueMs;
				session.ledger.append({ kind: "queue", sessionId: session.sessionId, parentSessionId: session.sessionId, label: child.label, queueMs: slot.queueMs, jobId: child.jobId });
				await launchChild(ctx, parent, session, prepared, expects, controller.signal);
				return await finished;
			})().then((outcome) => ({
				status: outcome.status === "killed" ? "killed" : outcome.status === "failed" ? "failed" : "completed",
				output: outcome.output ?? child.output,
				detail: outcome.detail
			})).catch((error) => ({
				status: controller.signal.aborted ? "killed" : "failed",
				output: child.output,
				detail: error instanceof Error ? error.message : String(error)
			}));
			return {
				cancel(reason) {
					controller.abort(reason ?? "job_kill");
					if (child.id.length > 0) {
						finishChild(session, child.id, { status: "killed", detail: typeof reason === "string" ? reason : "job_kill" });
						drainChild(ctx, parent, child.id);
					}
				},
				done: done.finally(() => {
					callerSignal.removeEventListener("abort", onCallerAbort);
					release();
				}),
				readOutput() {
					const raw = child.output;
					if (raw === child.shownOutput) return "";
					child.shownOutput = raw;
					if (raw.length === 0) return "";
					return prefixReportText(child.jobId ?? child.id, child.role, raw);
				}
			};
		}
	};
	const jobId = jobs.start({ ...spec, kind: "subagent" });
	child.jobId = String(jobId);
	return child.jobId;
}

async function launchChild(ctx, parent, session, prepared, expects, signal) {
	const child = prepared.child;
	const prompt = assignmentText(prepared.prompt, child.paths);
	const entry = { resolve: () => {}, settled: false, onPublished: undefined };
	entry.onPublished = (info) => {
		const childAgent = ctx.agents.get(info.id);
		if (childAgent === undefined) return;
		bindChild(ctx, parent, session, prepared, child, childAgent, String(info.id), prompt);
	};
	const published = new Promise((resolve) => { entry.resolve = resolve; });
	const list = expects.get(parent.id) ?? [];
	list.push(entry);
	expects.set(parent.id, list);
	let started;
	try {
		started = await ctx.subagents.startContinuable({
			provider: "spawn",
			label: child.label,
			signal,
			request: {
				prompt: [{ type: "text", text: prompt }],
				parent,
				persona: prepared.persona,
				maxDepth: CHILD_MAX_DEPTH,
				...prepared.deny.length > 0 ? { toolFilter: { deny: prepared.deny } } : {},
				...childRoute(session)
			}
		});
	} catch (error) {
		entry.settled = true;
		const detail = error instanceof Error ? error.message : String(error);
		session.ledger.append({
			kind: "reject",
			sessionId: session.sessionId,
			parentSessionId: session.sessionId,
			role: child.role,
			reason: detail
		});
		settle(child, { status: "failed", output: "", detail });
		throw error;
	}
	const info = await Promise.race([
		published,
		new Promise((resolve) => setTimeout(() => resolve({ id: started.childId }), 0))
	]);
	if (entry.error !== undefined) throw entry.error;
	const childId = String(started.childId ?? info.id);
	const childAgent = ctx.agents.get(childId);
	if (childAgent === undefined) {
		settle(child, { status: "failed", output: "", detail: "child agent was not published" });
		throw new Error("child agent was not published");
	}
	bindChild(ctx, parent, session, prepared, child, childAgent, childId, prompt);
}

function bindChild(ctx, parent, session, prepared, child, childAgent, childId, prompt) {
	if (child.bound === true) return;
	child.bound = true;
	child.id = childId;
	child.status = "running";
	child.addressable = true;
	noteSpawn(session, child, { roleSha: prepared.roleSha, prompt, model: modelLabel(parent) });
	installChild(ctx, parent, session, child, childAgent);
	announceId(childAgent, childId, child.role);
}

function installChild(ctx, parent, session, child, childAgent) {
	childAgent.ctx.tools.register(hubTool(ctx, session, child));
	childAgent.ctx.tools.guard((execution) => {
		if (execution.agent !== undefined && execution.agent !== childAgent) return undefined;
		const reason = guardChild(child, execution.name, execution.arguments);
		if (reason !== undefined) {
			session.ledger.append({
				kind: "reject",
				sessionId: session.sessionId,
				parentSessionId: session.sessionId,
				childId: child.id,
				tool: execution.name,
				reason
			});
		}
		return reason;
	});
	childAgent.ctx.on("agent/status", ({ status }) => {
		const events = readEvents(childAgent);
		noteStatus(session, child.id, status, events);
		if (status === "idle") {
			if (needsReportNudge(child.output, child.milNudged)) {
				child.milNudged = true;
				try {
					deliver(ctx, child.id, "followup", MIL_REPORT_NUDGE);
					return;
				} catch {
					// The rewrite ask could not be delivered. The parent sees an empty report.
				}
			}
			if (typeof child.onWaiting === "function") child.onWaiting();
			notifyParent(parent, child);
		}
	});
	childAgent.ctx.on("agent/disposed", () => {
		finishChild(session, child.id, { status: "completed", detail: "disposed" });
	});
}

function hubTool(ctx, session, child) {
	return defineTool({
		name: "hub",
		description: HUB_DESCRIPTION,
		parameters: {
			action: { type: "string", required: true, enum: ["status", "send", "wait"], description: "status, send, or wait." },
			to: { type: "string", description: "Living sibling roster id. Not a name you invented." },
			text: { type: "string", description: "MiL body only. No prose. No broadcast. Do not repeat the norm line." },
			timeout_ms: { type: "number", description: "wait bound in milliseconds, at most 300000." }
		},
		output: { schema: TEXT, render: (_args, value) => [{ type: "text", text: value.text }] },
		isConcurrencySafe: (args) => args.action !== "wait",
		async execute(args, exec) {
			if (exec.agent?.id !== child.id) return { text: "rejected: hub is bound to its child" };
			if (args.action === "status") return statusText(session, child.id);
			if (args.action === "send") {
				return sendSibling(session, { fromId: child.id, toId: args.to, text: args.text }, {
					inject: (id, text) => deliver(ctx, id, "inject", text),
					followup: (id, text) => deliver(ctx, id, "followup", text)
				});
			}
			if (args.action === "wait") {
				const timeout = Number.isFinite(args.timeout_ms) ? Math.min(Math.max(1, args.timeout_ms), WAIT_MAX_MS) : WAIT_DEFAULT_MS;
				return waitForPeer(child, exec.signal, timeout);
			}
			return { text: "rejected: action must be status, send, or wait" };
		}
	});
}

function deliver(ctx, id, method, text) {
	const agent = ctx.agents.get(id);
	if (agent === undefined || typeof agent[method] !== "function") throw new Error("peer left");
	agent[method](peerMessage(text));
}

function peerMessage(text) {
	return createUserMessage({
		content: [{ type: "text", text }],
		source: { kind: "plugin", plugin: PLUGIN, form: "relay" }
	});
}

function announceId(agent, childId, role) {
	const message = createUserMessage({
		content: [{ type: "text", text: rosterNotice(childId, role) }],
		source: { kind: "plugin", plugin: PLUGIN, form: "notice", summary: boundContextSummary("roster id") }
	});
	if (typeof agent.inject === "function") agent.inject(message);
}

function notifyParent(parent, child) {
	if (child.notifiedOutput === child.output && child.notifiedStatus === "waiting") return;
	child.notifiedOutput = child.output;
	child.notifiedStatus = "waiting";
	try {
		const body = parentNotice(child.jobId, child.role, child.label, child.output, "waiting");
		const message = createUserMessage({
			content: [{ type: "text", text: body }],
			source: { kind: "plugin", plugin: PLUGIN, form: "notice", summary: boundContextSummary(`${child.role} waiting`) }
		});
		if (parent.status === "running" && typeof parent.inject === "function") parent.inject(message);
		else if (typeof parent.followup === "function") parent.followup(message);
	} catch {
		// A notice failure must not finish or revive the child.
	}
}

function drainChild(ctx, parent, childId) {
	try {
		const drain = ctx.subagents.drainContinuableChildren;
		if (typeof drain === "function") void drain.call(ctx.subagents, parent, [childId]);
	} catch (error) {
		ctx.logger?.warn?.(`[omp-tasks] drain failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function firstResult(child, signal) {
	return new Promise((resolve, reject) => {
		const done = (text) => {
			signal.removeEventListener("abort", onAbort);
			resolve(text);
		};
		const onAbort = () => {
			reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		const prior = child.finish;
		child.finish = (outcome) => {
			if (prior !== null) prior(outcome);
			done(parentNotice(child.jobId, child.role, child.label, outcome.output ?? "", outcome.status));
		};
		child.onWaiting = () => done(parentNotice(child.jobId, child.role, child.label, child.output, "waiting"));
	});
}

function settle(child, outcome) {
	const finish = child.finish;
	child.finish = null;
	if (typeof finish === "function") finish(outcome);
}

function viewPayload(root, liveSessions, sessionId) {
	const session = liveSessions.get(sessionId);
	const records = readLedger(root).filter((record) => record.sessionId === sessionId || record.parentSessionId === sessionId);
	return projectView({
		enabled: resolveEnabled(session?.enabled, readSession(root, sessionId).enabled),
		subModel: session?.subModel !== undefined ? session.subModel : readSession(root, sessionId).subModel,
		live: session === undefined ? [] : [...session.children.values()].filter((child) => child.addressable === true),
		records,
		now: Date.now()
	});
}

function presentTools(ctx) {
	return KNOWN_TOOLS.filter((tool) => ctx.tools.get(tool) !== undefined);
}

function readEvents(agent) {
	try {
		if (typeof agent.session?.snapshotEvents === "function") return agent.session.snapshotEvents();
		if (typeof agent.session?.ownEvents === "function") return agent.session.ownEvents();
	} catch {
		return [];
	}
	return [];
}

function modelLabel(agent) {
	const options = agent.options;
	if (options === undefined || options === null) return undefined;
	const provider = options.provider ?? options.providerName;
	const model = options.model;
	if (typeof provider === "string" && typeof model === "string") return `${provider}/${model}`;
	return typeof model === "string" ? model : undefined;
}

function ompHome() {
	const root = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(root, "omp-tasks");
}

function roleDir() {
	return fileURLToPath(new URL("../agents/", import.meta.url));
}

function readRole(role) {
	try {
		return readFileSync(join(roleDir(), `${role}.md`), "utf8");
	} catch {
		return "";
	}
}

function snapshotRole(home, role, text, hash) {
	const dir = join(home, "agents");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const file = join(dir, `${role}-${hash}.md`);
	if (!existsSync(file)) writeFileSync(file, text, { mode: 0o600 });
	chmodSync(file, 0o600);
}

function openLedger(home) {
	mkdirSync(home, { recursive: true, mode: 0o700 });
	chmodSync(home, 0o700);
	const file = join(home, "ledger.jsonl");
	return new Ledger({
		append(line) {
			appendFileSync(file, line, { mode: 0o600 });
			chmodSync(file, 0o600);
		}
	});
}

function readLedger(home) {
	const file = join(home, "ledger.jsonl");
	if (!existsSync(file)) return [];
	const rows = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (line.trim().length === 0) continue;
		try { rows.push(JSON.parse(line)); } catch { /* skip a torn tail, do not invent the record */ }
	}
	return rows;
}

function readSession(home, sessionId) {
	if (!safeSessionId(sessionId)) return { enabled: false, subModel: null };
	const file = join(home, "sessions", `${sessionId}.json`);
	if (!existsSync(file)) return { enabled: false, subModel: null };
	try {
		return readSessionState(JSON.parse(readFileSync(file, "utf8")));
	} catch {
		return { enabled: false, subModel: null };
	}
}

function writeSession(home, sessionId, patch) {
	const previous = readSession(home, sessionId);
	const next = writeSessionDocument(previous, patch);
	if (!safeSessionId(sessionId)) return next;
	const dir = join(home, "sessions");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const file = join(dir, `${sessionId}.json`);
	const body = { enabled: next.enabled === true };
	if (next.subModel !== null) body.subModel = next.subModel;
	writeFileSync(file, `${JSON.stringify(body)}\n`, { mode: 0o600 });
	chmodSync(file, 0o600);
	return next;
}

function childRoute(session) {
	const options = childAgentOptions(session.subModel);
	return options === undefined ? {} : { agentOptions: options };
}

function safeSessionId(sessionId) {
	return typeof sessionId === "string" && sessionId.length > 0 && !sessionId.includes("/") && !sessionId.includes("\\") && !sessionId.includes("..");
}

function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

export { apply, inject, name };
