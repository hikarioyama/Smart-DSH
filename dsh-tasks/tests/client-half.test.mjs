import assert from "node:assert/strict";
import test from "node:test";

const registered = [];
globalThis.window = {
	__ModuleLoader__: {
		load({ factory }) {
			factory((id) => {
				if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
				if (id === "react") return { useEffect() {} };
				if (id === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: (initial) => ({ initial, set() {}, getSnapshot: () => initial }) };
				throw new Error(`unexpected require ${id}`);
			});
		}
	}
};

await import("../lib/client.js");

const ctx = {
	uiConversation: { views: { register(definition) { registered.push(definition); } } },
	slots: {
		inject(_name, fn) { fn(); },
		register(options, component) {
			registered.push({ options, component });
			return () => {};
		}
	},
	sessions: { open() {} }
};

const loaded = window.__ModuleLoader__.load;
void loaded;
const factoryExports = {};
window.__ModuleLoader__.load = ({ factory }) => {
	Object.assign(factoryExports, factory((id) => {
		if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
		if (id === "react") return { useEffect() {} };
		if (id === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: (initial) => ({ initial, set() {}, getSnapshot: () => initial }) };
		throw new Error(`unexpected require ${id}`);
	}));
};
await import(`../lib/client.js?second=${Date.now()}`);

test("subagent tab registers beside chat and trajectory", () => {
	factoryExports.apply(ctx);
	const view = registered.find((entry) => entry.options?.id === "subagents");
	assert.ok(view);
	assert.equal(view.options.order, 20);
	assert.equal(view.options.label(), "subagent");
	assert.equal(registered.some((entry) => entry.target === "subagents"), true);
});

test("status dots replace click-through history", () => {
	assert.equal(factoryExports.emptyLabel("off"), "usage: /subagents on|off|status");
	assert.equal(factoryExports.emptyLabel("none"), "usage: /subagents on|off|status");
	const view = {
		empty: null,
		live: [{ id: "c1", role: "explorer", status: "running", label: "measure", elapsedMs: 12 }],
		history: [
			{ kind: "spawn", childId: "c0", role: "hacker", label: "attack" },
			{ kind: "end", childId: "c0", role: "hacker", stopReason: "killed" },
			{ kind: "reject", role: "worker", reason: "no paths" }
		],
		hub: [{ phase: "delivered", from: "c1", to: "c2", receipt: "injected", text: "fact" }]
	};
	const lines = factoryExports.linesFor(view);
	assert.equal(lines.some((line) => line.includes("ms") || line.includes("fact") || line.includes("c1")), false);
	assert.match(lines.join("\n"), /green explorer measure/);
	assert.match(lines.join("\n"), /red hacker attack/);
	assert.equal(factoryExports.statusRows(view).find((row) => row.id === "c1").active, true);
	assert.equal(factoryExports.statusRows(view).find((row) => row.id === "c0").active, false);
	const injected = registered.find((entry) => entry.options?.id === "subagents");
	const props = injected.options.inject("parent-1");
	assert.equal(props.openSession, undefined);
	assert.equal(factoryExports.seatCopy({ enabled: false, subModel: { provider: "xai", model: "grok-4.7" } }, null), null);
	assert.deepEqual(factoryExports.seatCopy({ enabled: true, subModel: { provider: "xai", model: "grok-4.7" } }, null), { sub: "sub: grok-4.7", main: "main:" });
	const seat = registered.find((entry) => entry.options?.name === "conversation.input.right");
	assert.equal(seat.options.order, 80);
});
