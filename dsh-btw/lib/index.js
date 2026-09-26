import { ApiSessionNotFound } from "@deepseek-ai/dsh-api-session-controller";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
import { AssistantStreamAccumulator, BlockAssembler, ReasoningEffortId, createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import schema from "@deepseek-ai/schemastery";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { SessionId as SessionId$1 } from "@deepseek-ai/dsh-session/types";
import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

//#region src/compat/fork.ts
/** Uses real provider output, never fabricates an assistant stream. */
function appendSideTurns(session, turns) {
	let number = session.snapshotEvents().filter((e) => e.type === "turn/start").reduce((n, e) => Math.max(n, e.data.turn), 0);
	for (const { turn, message, stream } of turns) {
		if (message.content.some((block) => block.type === "tool-call")) throw Error("Cannot fork a tool-only BTW answer; no tools were executed");
		number++;
		session.append("turn/start", { turn: number });
		session.append("step/start", {
			turn: number,
			step: 1
		});
		session.append("user/message", createUserMessage({
			content: [{
				type: "text",
				text: turn.question
			}],
			source: { kind: "user" }
		}), { surfaceOp: "append" });
		session.append("assistant/message", {
			turn: number,
			step: 1,
			message,
			stream
		}, { surfaceOp: "append" });
		session.append("step/end", {
			turn: number,
			step: 1
		});
		session.append("turn/end", {
			turn: number,
			reason: { kind: "completed" }
		});
	}
}
async function forkThread(ctx, store, parentId, turnId) {
	const records = await store.records(parentId);
	const prior = records.findLast((r) => r.type === "fork" && r.id === turnId);
	if (prior) {
		if (prior.data.status !== "complete" || typeof prior.data.childSessionId !== "string") throw Error(`Prior fork ${prior.data.childSessionId ?? "(creation outcome unknown)"} requires inspection; refusing duplicate creation`);
		return prior.data.childSessionId;
	}
	const turns = await store.turns(parentId);
	const index = turns.findIndex((t) => t.id === turnId);
	const target = turns[index];
	if (!target || target.answer === void 0 || target.anchorSeq === null) throw Error("A completed BTW answer and completed parent turn are required");
	const entries = turns.slice(0, index + 1).filter((t) => t.answer !== void 0).map((turn) => {
		const archive = records.find((r) => r.type === "answer" && r.id === turn.id)?.data.archive;
		if (!archive?.message || !archive.stream) throw Error("Exact answer stream missing; cannot fork this record");
		return {
			turn,
			message: archive.message,
			stream: archive.stream
		};
	});
	const prefix = (await ctx.sessionController.inspect(SessionId(parentId))).events.slice(0, target.anchorSeq + 1);
	appendSideTurns(Session.create(SessionId("btw-validation"), prefix), entries);
	await store.append(parentId, "fork", turnId, {
		status: "requested",
		anchorSeq: target.anchorSeq
	});
	const fork = await ctx.sessionController.fork({
		sessionId: SessionId(parentId),
		atSeq: target.anchorSeq
	});
	const child = ctx.agents.get(fork.sessionId);
	if (!child) throw Error(`Fork ${fork.sessionId} created but not live; do not repeat blindly`);
	const originalSeq = child.session.seq;
	try {
		await store.append(parentId, "fork", turnId, {
			childSessionId: String(fork.sessionId),
			status: "created",
			anchorSeq: target.anchorSeq
		});
		if (child.session.seq !== originalSeq) throw Error("New fork changed before BTW insertion");
		appendSideTurns(child.session, entries);
		await ctx.sessionController.rename({
			sessionId: fork.sessionId,
			title: "BTW: " + target.question.replace(/\s+/g, " ").slice(0, 80)
		});
		await child.ctx.parallel(scopeTarget(child.session, child), "session/flush", child.session);
		await store.append(parentId, "fork", turnId, {
			childSessionId: String(fork.sessionId),
			status: "complete",
			anchorSeq: target.anchorSeq
		});
	} catch (error) {
		throw Error(`Fork ${fork.sessionId} was created but completion failed; inspect it rather than creating another fork`, { cause: error });
	}
	return String(fork.sessionId);
}

//#endregion
//#region src/shared/protocol.ts
const BTW_RPC_CHANNEL = "/api";
const BTW_ASK_ENDPOINT = "dsh-btw/ask";
function readAskRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const source = value;
	if (typeof source.requestId !== "string" || source.requestId.length === 0 || source.requestId.length > 128) return void 0;
	if (typeof source.sessionId !== "string" || source.sessionId.length === 0 || source.sessionId.length > 256) return void 0;
	if (typeof source.question !== "string") return void 0;
	const question = source.question.trim();
	if (question.length === 0 || question.length > 32e3) return void 0;
	return {
		requestId: source.requestId,
		sessionId: source.sessionId,
		question
	};
}
function readSessionRequest(value) {
	if (!value || typeof value !== "object") return void 0;
	const id = value.sessionId;
	return typeof id === "string" && id.length > 0 && id.length <= 256 ? { sessionId: id } : void 0;
}
const BTW_FORK_ENDPOINT = "dsh-btw/fork";

//#endregion
//#region src/compat/context.ts
const BTW_REMINDER = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- Follow-up questions may continue this side thread; keep each answer direct
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>`;
/** Longest prefix that does not leave an assistant tool call without its result. */
function balancedMessagePrefix(messages) {
	const pending = /* @__PURE__ */ new Set();
	let lastBalanced = 0;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message === void 0) continue;
		for (const block of message.content) {
			if (message.role === "assistant" && block.type === "tool-call") pending.add(String(block.id));
			if (message.role === "user" && block.type === "tool-result") pending.delete(String(block.toolCallId));
		}
		if (pending.size === 0) lastBalanced = index + 1;
	}
	return messages.slice(0, lastBalanced);
}
function wrapQuestion(question) {
	return `${BTW_REMINDER}\n\n${question}`;
}
function snapshotContext(agent, question, history = [], selected) {
	const header = agent.session.requestHeader();
	if (header === void 0) throw new Error("No model request context exists yet. Send one main-conversation message before using /btw.");
	const { reasoningEffort: _previousEffort,...baseConfig } = header.config;
	const config = structuredClone(selected === void 0 ? header.config : {
		...baseConfig,
		...selected
	});
	const sharedMessages = structuredClone(balancedMessagePrefix(agent.session.deriveMessages()));
	const sideQuestion = createUserMessage({
		content: [{
			type: "text",
			text: wrapQuestion(question)
		}],
		source: { kind: "user" }
	});
	return {
		parentSessionId: String(agent.session.id),
		config,
		...header.tools === void 0 ? {} : { tools: structuredClone(header.tools) },
		sharedMessages,
		messages: [
			...sharedMessages,
			...history.flatMap((turn) => turn.answer === void 0 ? [] : [createUserMessage({
				content: [{
					type: "text",
					text: turn.question
				}],
				source: { kind: "user" }
			}), createAssistantMessage({
				content: [{
					type: "text",
					text: turn.answer
				}],
				source: {
					provider: header.config.provider,
					model: header.config.model
				}
			})]),
			sideQuestion
		]
	};
}

//#endregion
//#region src/compat/model-call.ts
function textOf(blocks) {
	return blocks.filter((block) => block.type === "text").map((block) => block.text).filter((text) => text.trim().length > 0).join("\n\n").trim();
}
function toolOnlyFallback(blocks) {
	const call = blocks.find((block) => block.type === "tool-call");
	if (call === void 0) return void 0;
	return `(The model tried to call ${call.name.trim() === "" ? "a tool" : call.name} instead of answering directly. Try rephrasing or ask in the main conversation.)`;
}
async function runBtwOneShot(llm, snapshot, sidechainId, signal) {
	const requestBase = {
		messages: snapshot.messages,
		...snapshot.system === void 0 ? {} : { system: snapshot.system },
		...snapshot.tools === void 0 ? {} : { tools: snapshot.tools },
		sessionId: SessionId$1(sidechainId),
		signal
	};
	const prepared = await llm.prepareCall(snapshot.config, signal);
	const stream = prepared.stream({
		...prepared.config,
		...requestBase
	});
	const assembler = new BlockAssembler();
	const archive = new AssistantStreamAccumulator();
	for await (const chunk of stream) assembler.push(archive.push({
		time: Date.now(),
		chunk
	}).chunk);
	const finish = assembler.finish;
	if (finish.kind === "error" || finish.kind === "aborted") {
		const message = finish.failure.message || `LLM request ${finish.kind}`;
		throw new Error(message);
	}
	const blocks = assembler.blocks();
	const response = textOf(blocks) || toolOnlyFallback(blocks);
	if (response === void 0) throw new Error("No response received");
	return {
		response,
		archive: {
			message: createAssistantMessage({
				content: blocks,
				source: {
					provider: snapshot.config.provider,
					model: snapshot.config.model
				}
			}),
			stream: archive.snapshot()
		},
		...assembler.usage === void 0 ? {} : { usage: assembler.usage },
		cacheStrategy: "provider-managed",
		finishKind: finish.kind
	};
}

//#endregion
//#region src/compat/transport.ts
/** Add one plugin-owned endpoint to the authenticated shared carrier. */
function createBtwRpcRoute(handler, endpoint = BTW_ASK_ENDPOINT) {
	return {
		path: `${BTW_RPC_CHANNEL}/${endpoint}`,
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
			let body;
			try {
				body = await request.json();
			} catch {
				return new Response("body is not JSON", { status: 400 });
			}
			const envelope = clientRequestSchema.safeParse(body);
			if (!envelope.success) return new Response("invalid client-request envelope", { status: 400 });
			const { rpcId, method, payload } = envelope.data;
			if (method !== endpoint) return Response.json({
				type: "server-response",
				rpcId,
				result: {
					ok: false,
					error: {
						code: "bad-request",
						message: "Unexpected BTW method.",
						details: {}
					}
				}
			});
			const result = await handler(method, payload, request.signal);
			return Response.json({
				type: "server-response",
				rpcId,
				result
			});
		}
	};
}

//#endregion
//#region src/core/audit-store.ts
/** Versioned audit data, independent of DSH storage. Never prunes records. */
var AuditStore = class {
	constructor(root) {
		this.root = root;
	}
	filename(sessionId) {
		if (!sessionId || sessionId.length > 256) throw Error("Invalid session identity");
		return join(this.root, createHash("sha256").update(sessionId).digest("hex") + ".jsonl");
	}
	async records(sessionId) {
		let text;
		try {
			text = await readFile(this.filename(sessionId), "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
		if (text && !text.endsWith("\n")) throw Error("Incomplete audit tail; preserve file and repair before continuing");
		return text.split("\n").filter(Boolean).map((line) => {
			const item = JSON.parse(line);
			if (item.version !== 1 || item.sessionId !== sessionId || typeof item.id !== "string" || ![
				"question",
				"answer",
				"error",
				"fork"
			].includes(item.type) || !Number.isFinite(item.at) || item.data === null || typeof item.data !== "object") throw Error("Invalid audit record; refusing to overwrite");
			return item;
		});
	}
	/** Keep large request snapshots outside the small thread index. Content-addressed, immutable. */
	async snapshot(data) {
		const text = JSON.stringify(data);
		const sha256 = createHash("sha256").update(text).digest("hex");
		const dir = join(this.root, "contexts");
		await mkdir(dir, {
			recursive: true,
			mode: 448
		});
		const path = join(dir, sha256 + ".json");
		try {
			const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
			try {
				await file.writeFile(text);
				await file.sync();
			} finally {
				await file.close();
			}
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (createHash("sha256").update(await readFile(path)).digest("hex") !== sha256) throw Error("Damaged audit context; refusing reuse");
		}
		return { sha256 };
	}
	async turns(sessionId) {
		const turns = /* @__PURE__ */ new Map();
		for (const r of await this.records(sessionId)) if (r.type === "question") {
			if (turns.has(r.id) || typeof r.data.question !== "string") throw Error("Duplicate or invalid question record");
			turns.set(r.id, {
				id: r.id,
				question: r.data.question,
				at: r.at,
				anchorSeq: typeof r.data.anchorSeq === "number" ? r.data.anchorSeq : null
			});
		} else if (r.type === "answer" || r.type === "error") {
			const turn = turns.get(r.id);
			if (!turn) throw Error("Orphan audit result");
			if (r.type === "answer" && typeof r.data.answer === "string") turn.answer = r.data.answer;
			else if (r.type === "error" && typeof r.data.error === "string") turn.error = r.data.error;
			else throw Error("Invalid audit result");
			if (typeof r.data.durationMs === "number") turn.durationMs = r.data.durationMs;
		}
		return [...turns.values()];
	}
	/** Caller serializes a session across the entire request, not just each append. */
	async append(sessionId, type, id, data) {
		await this.records(sessionId);
		await mkdir(this.root, {
			recursive: true,
			mode: 448
		});
		const file = await open(this.filename(sessionId), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
		try {
			await file.writeFile(JSON.stringify({
				version: 1,
				sessionId,
				type,
				id,
				at: Date.now(),
				data
			}) + "\n");
			await file.sync();
		} finally {
			await file.close();
		}
	}
};

//#endregion
//#region src/core/thread-service.ts
/** One active request per parent; independent parents remain concurrent. */
var ThreadService = class {
	busy = /* @__PURE__ */ new Set();
	constructor(store, deps) {
		this.store = store;
		this.deps = deps;
	}
	isBusy(sessionId) {
		return this.busy.has(sessionId);
	}
	history(sessionId) {
		return this.store.turns(sessionId);
	}
	async ask(sessionId, id, question, signal) {
		if (this.busy.has(sessionId)) throw Error("A BTW request is already running in this session");
		this.busy.add(sessionId);
		try {
			signal.throwIfAborted();
			const turns = await this.history(sessionId);
			const prior = turns.find((t) => t.id === id);
			if (prior) {
				if (prior.question !== question) throw Error("Request identity reused with different question");
				if (prior.answer !== void 0) return prior;
				throw Error(prior.error ?? "Previous request was interrupted; use a new request identity");
			}
			const context = this.deps.snapshot(sessionId, turns, question);
			const started = Date.now();
			const request = await this.store.snapshot(context.audit);
			await this.store.append(sessionId, "question", id, {
				question,
				anchorSeq: context.anchorSeq,
				request,
				historyIds: turns.filter((t) => t.answer !== void 0).map((t) => t.id)
			});
			try {
				signal.throwIfAborted();
				const result = await this.deps.generate(context, id, signal);
				signal.throwIfAborted();
				await this.store.append(sessionId, "answer", id, {
					answer: result.response,
					cacheStrategy: result.cacheStrategy,
					...result.archive === void 0 ? {} : { archive: result.archive },
					...result.usage === void 0 ? {} : { usage: result.usage },
					durationMs: Date.now() - started
				});
			} catch (error) {
				await this.store.append(sessionId, "error", id, {
					error: signal.aborted ? "cancelled-or-timeout" : "generation-or-audit-failed",
					durationMs: Date.now() - started
				});
				throw error;
			}
			const turn = (await this.history(sessionId)).find((t) => t.id === id);
			if (!turn) throw Error("Audit result missing");
			return turn;
		} finally {
			this.busy.delete(sessionId);
		}
	}
};

//#endregion
//#region src/compat/host.ts
const Config = schema.object({
	timeoutMs: schema.natural().min(1).default(12e4),
	auditRoot: schema.string()
});
function installBtwService(ctx, config = {}) {
	const store = new AuditStore(config.auditRoot ?? join(resolveDshHome(), "btw-threads", "v1"));
	const forking = /* @__PURE__ */ new Set();
	const service = new ThreadService(store, {
		snapshot(sessionId, history, question) {
			const agent = ctx.agents.get(SessionId(sessionId));
			if (!agent) throw Error("No live parent session. Open the main conversation first.");
			const selection = ctx.sessionProjections.stateOf(agent.session, "modelSelection");
			if (!selection) throw Error("Model selection projection unavailable; refusing a possibly stale model route");
			const pending = selection.pending;
			const snapshot = snapshotContext(agent, question, history, pending === null ? void 0 : {
				provider: pending.provider,
				model: pending.model,
				...pending.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(pending.reasoningEffort) }
			});
			return {
				agent,
				snapshot,
				anchorSeq: agent.session.snapshotEvents().findLast((e) => e.type === "turn/end")?.seq ?? null,
				audit: {
					provider: snapshot.config.provider,
					model: snapshot.config.model,
					parentMessages: snapshot.sharedMessages,
					sideInstruction: BTW_REMINDER,
					...snapshot.config.reasoningEffort === void 0 ? {} : { reasoningEffort: snapshot.config.reasoningEffort },
					...snapshot.tools ? { tools: snapshot.tools } : {}
				}
			};
		},
		generate(context, id, signal) {
			return ctx.agents.withInitiator(context.agent, () => runBtwOneShot(ctx.llm, context.snapshot, id, signal));
		}
	});
	for (const endpoint of [BTW_ASK_ENDPOINT, BTW_FORK_ENDPOINT]) ctx.effect(() => ctx.connection.fetch.register(createBtwRpcRoute(async (method, payload, signal) => {
		try {
			const session = readSessionRequest(payload);
			if (!session) return {
				ok: false,
				error: {
					code: "bad-request",
					message: "Invalid session request",
					details: { issues: [] }
				}
			};
			if (forking.has(session.sessionId)) throw Error("A fork is in progress");
			if (method === BTW_FORK_ENDPOINT) {
				if (service.isBusy(session.sessionId)) throw Error("Wait for the current BTW request");
				const turnId = payload.turnId;
				if (typeof turnId !== "string") throw Error("Invalid turn identity");
				forking.add(session.sessionId);
				try {
					return {
						ok: true,
						value: { childSessionId: await forkThread(ctx, store, session.sessionId, turnId) }
					};
				} finally {
					forking.delete(session.sessionId);
				}
			}
			const request = readAskRequest(payload);
			if (!request) throw Error("Invalid /btw request");
			const combined = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 12e4)]);
			combined.throwIfAborted();
			const resolved = await ctx.sessionController.resolveAgent(SessionId(request.sessionId));
			if ("error" in resolved) {
				if (resolved.error.code === "session/not-found") throw new ApiSessionNotFound(resolved.error.message);
				throw resolved.error;
			}
			combined.throwIfAborted();
			if (forking.has(session.sessionId)) throw Error("A fork is in progress");
			return {
				ok: true,
				value: { turn: await service.ask(request.sessionId, request.requestId, request.question, combined) }
			};
		} catch (error) {
			if (error instanceof ApiSessionNotFound) return {
				ok: false,
				error: {
					code: "session-not-found",
					message: error.message,
					details: {}
				}
			};
			return {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : "BTW failed",
					details: {}
				}
			};
		}
	}, endpoint)));
}

//#endregion
//#region src/index.ts
const name = "btw";
const inject = [
	"agents",
	"connection",
	"llm",
	"sessionController",
	"sessionProjections"
];
function apply(ctx, config) {
	installBtwService(ctx, config);
}

//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=index.js.map