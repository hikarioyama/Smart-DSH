import assert from "node:assert/strict";
import test from "node:test";
import {
	CHILD_MAX_DEPTH,
	Ledger,
	SlotPool,
	assistantTextFromEvents,
	decideTool,
	deliverAfterLedger,
	emptyLabel,
	livingStatus,
	pathAllowed,
	MIL_NORM,
	MIL_REJECT,
	assignmentText,
	childAgentOptions,
	milSendable,
	parseSubModel,
	subMenuVisible,
	writeSessionDocument,
	needsReportNudge,
	parentNotice,
	prefixPeerText,
	prefixReportText,
	reportBody,
	projectView,
	resolveEnabled,
	routeSend,
	shellWriteLikely,
	validateAssignment
} from "../lib/core.js";
import { finishChild, prepareLaunch, sendSibling, statusText, SessionTasks } from "../lib/coordinator.js";

test("child depth cap allows the first child and not a zero cap", () => {
	assert.equal(CHILD_MAX_DEPTH, 1);
});

test("worker without paths is refused and does not become a child", () => {
	const ledger = new Ledger({ append() {} });
	const session = new SessionTasks("parent", { ledger, now: () => 1 });
	const result = prepareLaunch(session, { role: "worker", description: "edit", prompt: "change it", paths: [], cwd: "/repo", roleText: "worker" });
	assert.equal(result.ok, false);
	assert.match(result.reason, /path/);
	assert.equal(session.children.size, 0);
	assert.equal(ledger.records.at(-1).kind, "reject");
});

test("other roles may omit paths", () => {
	for (const role of ["explorer", "reviewer", "hacker"]) {
		const checked = validateAssignment({ role, description: "look", prompt: "task:=measure", paths: [] });
		assert.equal(checked.ok, true, role);
	}
});

test("send receipts are injected, woken, or gone, and gone does not retry", () => {
	const ledger = new Ledger({ append() {} });
	const session = new SessionTasks("parent", { ledger, now: () => 1 });
	session.enabled = true;
	const running = child("a", "running");
	const waiting = child("b", "waiting");
	const gone = child("c", "gone");
	gone.addressable = false;
	session.add(running);
	session.add(waiting);
	session.add(gone);
	const calls = [];
	const ports = {
		inject: (id) => calls.push(["inject", id]),
		followup: (id) => calls.push(["followup", id])
	};
	assert.equal(sendSibling(session, { fromId: "a", toId: "b", text: "kind:=fact" }, ports).text, "woken");
	assert.equal(sendSibling(session, { fromId: "b", toId: "a", text: "kind:=blocker" }, ports).text, "injected");
	assert.equal(sendSibling(session, { fromId: "a", toId: "c", text: "late" }, ports).text, "gone");
	assert.equal(sendSibling(session, { fromId: "a", toId: "a", text: "self" }, ports).text, "gone");
	assert.equal(sendSibling(session, { fromId: "a", toId: "invented", text: "no" }, ports).text, "gone");
	assert.deepEqual(calls, [["followup", "b"], ["inject", "a"]]);
	assert.equal(routeSend({ fromId: "a", toId: "c", roster: session.roster() }).receipt, "gone");
});

test("plain prose is not filtered by role kind", () => {
	const ledger = new Ledger({ append() {} });
	const session = new SessionTasks("parent", { ledger, now: () => 1 });
	const hacker = child("h", "waiting");
	hacker.role = "hacker";
	const worker = child("w", "running");
	worker.role = "worker";
	session.add(hacker);
	session.add(worker);
	const calls = [];
	const result = sendSibling(session, { fromId: "h", toId: "w", text: "kind:order; act:implement" }, {
		inject() { calls.push("inject"); },
		followup() { calls.push("followup"); }
	});
	assert.equal(result.text, "injected");
	assert.deepEqual(calls, ["inject"]);
	assert.equal(ledger.records.find((row) => row.phase === "accepted").text, "kind:order; act:implement");
	calls.length = 0;
	const prose = sendSibling(session, { fromId: "h", toId: "w", text: "implement this anyway" }, {
		inject() { calls.push("inject"); },
		followup() { calls.push("followup"); }
	});
	assert.equal(prose.text, MIL_REJECT);
	assert.deepEqual(calls, []);
	assert.equal(ledger.records.find((row) => row.reason === "not-mil").phase, "rejected");
});

test("ledger records the send before delivery", () => {
	const order = [];
	const ledger = new Ledger({ append() { order.push("ledger"); } });
	const result = deliverAfterLedger(ledger, { kind: "hub", text: "fact" }, () => {
		order.push("deliver");
		assert.equal(ledger.records[0].phase, "accepted");
		return { receipt: "injected" };
	});
	assert.equal(result.receipt, "injected");
	assert.deepEqual(order, ["ledger", "deliver", "ledger"]);
});

test("off keeps history", () => {
	const view = projectView({
		enabled: false,
		live: [],
		records: [{ kind: "spawn", childId: "c1" }, { kind: "hub", text: "kept", phase: "delivered" }],
		now: 10
	});
	assert.equal(view.empty, "off");
	assert.equal(view.history.length, 1);
	assert.equal(view.hub.length, 1);
	assert.equal(emptyLabel("off"), "usage: /subagents on|off|status");
	assert.equal(resolveEnabled(false, true), true);
	assert.equal(resolveEnabled(false, false), false);
	assert.equal(emptyLabel("none"), "usage: /subagents on|off|status");
});

test("fifth slot waits and reports measured queueMs", async () => {
	let now = 100;
	const pool = new SlotPool(4, () => now);
	const held = [];
	for (let i = 0; i < 4; i += 1) held.push(await pool.acquire(new AbortController().signal));
	let queued;
	const fifth = pool.acquire(new AbortController().signal).then((slot) => { queued = slot; });
	await Promise.resolve();
	assert.equal(queued, undefined);
	now = 180;
	held[0].release();
	await fifth;
	assert.equal(queued.queueMs, 80);
});

test("role guards refuse the other verb", () => {
	const scope = { paths: ["src/a.js"], cwd: "/repo" };
	assert.equal(decideTool("explorer", "write", { path: "src/a.js" }, scope).allow, false);
	assert.equal(decideTool("worker", "write", { path: "src/a.js" }, scope).allow, true);
	assert.equal(decideTool("worker", "write", { path: "other.js" }, scope).allow, false);
	assert.equal(decideTool("reviewer", "bash", { command: "ls" }, scope).allow, false);
	assert.equal(decideTool("hacker", "edit", { path: "src/a.js" }, scope).allow, false);
	assert.equal(decideTool("hacker", "bash", { command: "tee out" }, scope).allow, false);
	assert.equal(decideTool("hacker", "mcp__web__web_search", {}, scope).allow, false);
	assert.equal(decideTool("explorer", "mcp__web__web_search", {}, scope).allow, true);
	assert.equal(decideTool("hacker", "mcp__knowledge-graph__kg_search", {}, scope).allow, true);
	assert.equal(decideTool("worker", "mcp__knowledge-graph__kg_search", {}, scope).allow, false);
	assert.equal(decideTool("explorer", "ask_user_question", {}, scope).allow, false);
	assert.equal(decideTool("worker", "task", {}, scope).allow, false);
	assert.equal(decideTool("hacker", "bash", { command: "systemctl start vllm" }, scope).allow, false);
	assert.equal(shellWriteLikely("wc -l src/a.js"), false);
	assert.equal(pathAllowed("src/a.js", ["src"], "/repo"), true);
	assert.equal(pathAllowed("../secret", ["src"], "/repo"), false);
});

test("status lists only living siblings", () => {
	const ledger = new Ledger({ append() {} });
	const session = new SessionTasks("parent", { ledger, now: () => 1 });
	session.add(child("self", "running"));
	session.add(child("sib", "waiting"));
	const finished = child("old", "gone");
	finished.addressable = false;
	session.add(finished);
	const text = statusText(session, "self").text;
	assert.match(text, /sib/);
	assert.doesNotMatch(text, /self/);
	assert.doesNotMatch(text, /old/);
	assert.equal(livingStatus("self", session.children.values()).length, 1);
});

test("finishing a child makes a later send gone", () => {
	const ledger = new Ledger({ append() {} });
	const session = new SessionTasks("parent", { ledger, now: () => 1 });
	session.add(child("a", "running"));
	session.add(child("b", "waiting"));
	finishChild(session, "b", { status: "completed" });
	finishChild(session, "b", { status: "completed" });
	const result = sendSibling(session, { fromId: "a", toId: "b", text: "again" }, { inject() { throw new Error("revived"); }, followup() { throw new Error("revived"); } });
	assert.equal(result.text, "gone");
	assert.equal(ledger.records.filter((row) => row.kind === "end").length, 1);
});

test("assistant text comes only from recorded events", () => {
	assert.equal(assistantTextFromEvents([{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "measured" }] } } }]), "measured");
	assert.equal(assistantTextFromEvents([]), "");
});

test("peer text carries the norm, then the sender, then m", () => {
	const body = "loc:=file:1";
	assert.equal(prefixPeerText("a", "explorer", body), `${MIL_NORM}\n\nenv:from={a,explorer}; m@after; ¬infer\n\n${body}`);
	assert.equal(prefixPeerText("a", "explorer", `${MIL_NORM}\n\n${body}`), `${MIL_NORM}\n\nenv:from={a,explorer}; m@after; ¬infer\n\n${body}`);
	assert.equal(milSendable("file:1"), false);
	assert.equal(milSendable("qmin:=\"what line?\""), true);
	assert.equal(milSendable("\"what line?\""), false);
});

test("a prose assignment is refused and a MiL assignment keeps the norm off m", () => {
	const prose = validateAssignment({ role: "explorer", description: "look", prompt: "read the public page", paths: [] });
	assert.equal(prose.ok, false);
	assert.match(prose.reason, /MiL/);
	const text = assignmentText("task:read; target:=\"public page\"", ["src/a.js"]);
	assert.equal(text.startsWith(`${MIL_NORM}\n\n`), true);
	assert.match(text, /paths:=\{"src\/a\.js"\}/);
	assert.equal(text.split(MIL_NORM).length, 2);
});

test("a child route survives a toggle and does not carry effort", () => {
	const kept = writeSessionDocument({ enabled: true, subModel: { provider: "xai", model: "grok-4.7" } }, { enabled: false });
	assert.equal(kept.enabled, false);
	assert.deepEqual(kept.subModel, { provider: "xai", model: "grok-4.7" });
	const toggled = writeSessionDocument(kept, { enabled: true });
	assert.deepEqual(toggled.subModel, kept.subModel);
	assert.equal(childAgentOptions(null), undefined);
	assert.deepEqual(childAgentOptions({ provider: "xai", model: "grok-4.7" }), { provider: "xai", model: "grok-4.7" });
	assert.equal(parseSubModel({ provider: "xai", model: "a/b" }), null);
	assert.equal(subMenuVisible(false), false);
	assert.equal(subMenuVisible(true), true);
	assert.deepEqual(projectView({ enabled: true, live: [], records: [], subModel: { provider: "xai", model: "grok-4.7" } }).subModel, { provider: "xai", model: "grok-4.7" });
});

test("a prose report is not forwarded and is nudged once", () => {
	assert.equal(reportBody("measured the file"), "report:=∅ ∵ ¬MiL");
	assert.equal(reportBody(""), "report:=∅");
	assert.equal(reportBody("loc:=file:1"), "loc:=file:1");
	assert.match(prefixReportText("job-1", "explorer", "measured"), /report:=∅ ∵ ¬MiL/);
	assert.match(parentNotice("job-1", "explorer", "look", "loc:=file:1", "waiting"), /status:=waiting/);
	assert.equal(needsReportNudge("measured", false), true);
	assert.equal(needsReportNudge("measured", true), false);
	assert.equal(needsReportNudge("loc:=file:1", false), false);
});

function child(id, status) {
	return {
		id,
		role: "explorer",
		label: id,
		status,
		addressable: status === "running" || status === "waiting",
		lastTool: "read",
		jobId: null,
		startedAt: 1,
		output: "",
		paths: [],
		cwd: "/repo",
		waiters: [],
		finish: null
	};
}
