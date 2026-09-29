import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "dsh-omp-tasks-"));

const hooks = new Map();
const commands = [];
const routes = new Map();
const starts = [];
const jobs = [];

function agentCtx() {
	const tools = new Map();
	const listeners = new Map();
	return {
		tools: {
			register(definition) {
				tools.set(definition.name, definition);
				return () => tools.delete(definition.name);
			},
			guard() { return () => {}; }
		},
		systemPrompt: {
			getSectionOrder() { return 10; },
			section() { return () => {}; }
		},
		effect(fn) {
			const dispose = fn();
			return () => { if (typeof dispose === "function") dispose(); };
		},
		on(event, listener) {
			const list = listeners.get(event) ?? [];
			list.push(listener);
			listeners.set(event, list);
			return () => {};
		},
		toolsMap: tools,
		listeners
	};
}

const parent = {
	id: "parent-1",
	status: "idle",
	options: { provider: "xai", model: "grok-4.7" },
	session: { cwd: "/repo" },
	ctx: agentCtx(),
	inject() {},
	followup() {}
};

const ctx = {
	logger: { warn() {} },
	agents: {
		roots: () => [parent],
		get: () => undefined
	},
	commands: { register(command) { commands.push(command); return () => {}; } },
	subagents: {
		async startContinuable() {
			starts.push("start");
			throw new Error("start should not run");
		}
	},
	tools: { get: () => undefined },
	systemPrompt: { section() { return () => {}; }, getSectionOrder() { return 10; } },
	jobs: { start() { throw new Error("job should not start"); } },
	get(name) { return name === "jobs" ? ctx.jobs : undefined; },
	on(event, listener) {
		const list = hooks.get(event) ?? [];
		list.push(listener);
		hooks.set(event, list);
		return () => {};
	},
	inject(names, fn) {
		if (names.includes("webServer")) {
			fn({
				connection: { requestRejection: (req) => req.headers.cookie === "ok" ? undefined : 401 },
				webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
				effect(inner) { inner(); }
			});
		}
	}
};

const { apply } = await import("../lib/index.js");
apply(ctx);

function command(name) {
	return commands.find((item) => item.name === name);
}

test("slash command and view route register, default is off", async () => {
	assert.equal(command("subagents").name, "subagents");
	assert.equal(command("subagents").description, "usage: /subagents on|off|status");
	assert.equal(routes.has("/api/omp-tasks/view"), true);
	const status = await command("subagents").handler({ agent: parent, rawInput: "status" });
	assert.equal(status.kind, "success");
	assert.match(status.text, /off/);
	assert.equal(parent.ctx.toolsMap.has("task"), false);
});

test("unusable command names show English usage and do not toggle", async () => {
	const before = parent.ctx.toolsMap.has("task");
	const task = await command("task").handler({ agent: parent, rawInput: "on" });
	assert.equal(task.kind, "error");
	assert.equal(task.text, "usage: /subagents on|off|status");
	const tasks = await command("tasks").handler({ agent: parent, rawInput: "" });
	assert.equal(tasks.kind, "error");
	assert.equal(tasks.text, "usage: /subagents on|off|status");
	const bare = await command("subagents").handler({ agent: parent, rawInput: "" });
	assert.equal(bare.kind, "error");
	assert.equal(bare.text, "usage: /subagents on|off|status");
	assert.equal(parent.ctx.toolsMap.has("task"), before);
});

test("on installs task and off removes it without deleting the ledger", async () => {
	const on = await command("subagents").handler({ agent: parent, rawInput: "on" });
	assert.equal(on.kind, "success");
	assert.equal(parent.ctx.toolsMap.has("task"), true);
	assert.equal(parent.ctx.toolsMap.has("hub"), false);
	const ledger = join(process.env.DSH_HOME, "omp-tasks", "ledger.jsonl");
	assert.equal(existsSync(ledger), true);
	const before = readFileSync(ledger, "utf8");
	const off = await command("subagents").handler({ agent: parent, rawInput: "off" });
	assert.match(off.text, /Logs were kept/);
	assert.equal(parent.ctx.toolsMap.has("task"), false);
	assert.equal(existsSync(ledger), true);
	assert.ok(readFileSync(ledger, "utf8").length >= before.length);
});

test("worker without paths does not start a child", async () => {
	await command("subagents").handler({ agent: parent, rawInput: "on" });
	const tool = parent.ctx.toolsMap.get("task");
	const result = await tool.execute({ role: "worker", description: "edit", prompt: "change it", paths: [] }, { agent: parent, signal: new AbortController().signal });
	assert.match(result.text, /rejected/);
	assert.equal(starts.length, 0);
	assert.equal(jobs.length, 0);
});

test("view route refuses an anonymous request and an empty session", async () => {
	const route = routes.get("/api/omp-tasks/view");
	const denied = capture();
	await route.handler({ headers: {}, url: "/api/omp-tasks/view?session=parent-1" }, denied.res);
	assert.equal(denied.status, 401);
	const bad = capture("ok");
	await route.handler({ headers: { cookie: "ok" }, url: "/api/omp-tasks/view" }, bad.res);
	assert.equal(bad.status, 400);
	const ok = capture("ok");
	await route.handler({ headers: { cookie: "ok" }, url: "/api/omp-tasks/view?session=parent-1" }, ok.res);
	assert.equal(ok.status, 200);
	assert.equal(typeof ok.body.enabled, "boolean");
	assert.ok(Array.isArray(ok.body.live));
	assert.ok(Array.isArray(ok.body.hub));
});

test("spawn asks for maxDepth 1 so the first child is not rejected", async () => {
	await command("subagents").handler({ agent: parent, rawInput: "on" });
	const seen = [];
	const previousStart = ctx.jobs.start;
	const previousSub = ctx.subagents.startContinuable;
	ctx.jobs.start = (spec) => {
		assert.equal(spec.kind, "subagent");
		queueMicrotask(() => { spec.run(); });
		return "job-depth";
	};
	ctx.subagents.startContinuable = async (call) => {
		seen.push(call);
		throw new Error("stop after capture");
	};
	try {
		const tool = parent.ctx.toolsMap.get("task");
		const result = await tool.execute({
			role: "explorer",
			description: "look",
			prompt: "task:read; target:=\"public page\"",
			run_in_background: true
		}, { agent: parent, signal: new AbortController().signal });
		assert.match(result.text, /started subagent job job-depth/);
		assert.equal(result.text.includes("omp"), false);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(seen.length, 1);
		assert.equal(seen[0].request.maxDepth, 1);
		assert.equal(seen[0].request.agentOptions, undefined);
		assert.match(seen[0].request.prompt[0].text, /^MiL;/);
		assert.match(seen[0].request.prompt[0].text, /target:=/);
	} finally {
		ctx.jobs.start = previousStart;
		ctx.subagents.startContinuable = previousSub;
	}
});

test("a stored sub model is passed to the child and a toggle keeps it", async () => {
	await command("subagents").handler({ agent: parent, rawInput: "on" });
	const route = routes.get("/api/omp-tasks/sub-model");
	const saved = capture("ok");
	await route.handler({
		method: "POST",
		headers: { cookie: "ok" },
		url: "/api/omp-tasks/sub-model?session=parent-1&provider=xai&model=grok-4"
	}, saved.res);
	assert.equal(saved.status, 200);
	assert.deepEqual(saved.body.subModel, { provider: "xai", model: "grok-4" });
	const seen = [];
	const previousStart = ctx.jobs.start;
	const previousSub = ctx.subagents.startContinuable;
	ctx.jobs.start = (spec) => {
		queueMicrotask(() => { spec.run(); });
		return "job-sub-model";
	};
	ctx.subagents.startContinuable = async (call) => {
		seen.push(call);
		throw new Error("stop after capture");
	};
	try {
		const tool = parent.ctx.toolsMap.get("task");
		await tool.execute({
			role: "explorer",
			description: "look",
			prompt: "task:=read",
			run_in_background: true
		}, { agent: parent, signal: new AbortController().signal });
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.deepEqual(seen[0].request.agentOptions, { provider: "xai", model: "grok-4" });
	} finally {
		ctx.jobs.start = previousStart;
		ctx.subagents.startContinuable = previousSub;
	}
	await command("subagents").handler({ agent: parent, rawInput: "off" });
	const file = JSON.parse(readFileSync(join(process.env.DSH_HOME, "omp-tasks", "sessions", "parent-1.json"), "utf8"));
	assert.equal(file.enabled, false);
	assert.deepEqual(file.subModel, { provider: "xai", model: "grok-4" });
});

function capture(cookie) {
	const out = { status: 0, body: undefined, res: null };
	out.res = {
		writeHead(status) { out.status = status; },
		end(payload) { if (typeof payload === "string" && payload.startsWith("{")) out.body = JSON.parse(payload); }
	};
	void cookie;
	return out;
}
