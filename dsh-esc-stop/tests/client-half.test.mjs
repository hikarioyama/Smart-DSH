// Client-half checks for dsh-esc-stop: the Escape decision, the listener wiring,
// and the General-settings row registration. Loads the real shipped bundle
// through a __ModuleLoader__ shim, so the file under test is the file DSH serves.
import { test } from "node:test";
import assert from "node:assert/strict";

//#region module-loader shim
let captured;
globalThis.window = {
	__ModuleLoader__: {
		load(definition) {
			captured = definition;
		}
	}
};

/** jsx/jsxs stubs: the row is inspected by props, not rendered. */
const element = (type, props, key) => ({ type, props, key });
const requireShim = (name) => {
	if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
	if (name === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: createSnapshotStoreStub };
	throw new Error(`unexpected require: ${name}`);
};

/** createSnapshotStore twin: same getSnapshot/subscribe/update surface. */
function createSnapshotStoreStub(initial) {
	let state = initial;
	const subscribers = new Set();
	return {
		getSnapshot: () => state,
		subscribe(listener) {
			subscribers.add(listener);
			return () => subscribers.delete(listener);
		},
		set(value) {
			state = value;
			for (const listener of subscribers) listener();
		},
		update(mutate) {
			mutate(state);
			for (const listener of subscribers) listener();
		}
	};
}
//#endregion

await import("../lib/client.js");
assert.equal(captured.id, "dsh-esc-stop");
const client = captured.factory(requireShim);
assert.deepEqual(client.inject, ["sessions", "slots", "settingsScope"]);
assert.equal(typeof client.apply, "function");

const ESCAPE = { key: "Escape" };

/**
 * Run one apply() against fakes and return every observable the tests assert on.
 * @param options - session/turn shape, settings section, modal, and service presence.
 * @returns the recorded interactions plus a keydown dispatcher.
 */
function harness({
	running = true,
	current = "s1",
	subagent = null,
	removed = false,
	value = { enabled: true },
	writable = true,
	modal = false,
	overlay = false,
	conversationAvailable = true,
	settingsAvailable = true,
	sessionsBroken = false
} = {}) {
	const state = {
		cancels: [],
		writes: [],
		slots: [],
		rows: [],
		effects: [],
		listeners: new Map(),
		bindSpecs: []
	};

	const snapshot = { running, removed, subagent };
	const session = {
		sessionId: current,
		getSnapshot: () => snapshot,
		cancel: () => {
			state.cancels.push("session");
			return Promise.resolve({ ok: true });
		}
	};
	const sessions = {
		list: {
			getSnapshot: () => {
				if (sessionsBroken) throw new Error("host session list unavailable");
				return { current, byId: current === undefined || current === null ? {} : { [current]: { running } } };
			}
		},
		binding: (id) => (current !== undefined && current !== null && id === current ? { sessionId: id, session } : undefined),
		scope: (id) => (current !== undefined && current !== null && id === current ? {
			get: (name) => (name === "conversation" && conversationAvailable ? {
				cancel: () => {
					state.cancels.push("conversation");
					return Promise.resolve({ ok: true });
				}
			} : undefined)
		} : undefined)
	};

	const settingsScope = {
		getSnapshot: () => ({ status: "ready", value, base: undefined, user: undefined, revision: 1, writable, mode: "host" }),
		subscribe: () => () => {},
		set: (field, next) => {
			state.writes.push([field, next]);
			return Promise.resolve();
		},
		unset: () => Promise.resolve(),
		mutate: () => Promise.resolve()
	};

	const ctx = {
		settingsScope: settingsAvailable ? { bind: (spec) => (state.bindSpecs.push(spec), settingsScope) } : undefined,
		slots: {
			inject: (name, fn) => (state.slots.push(name), fn()),
			register: (options, Component) => (state.rows.push({ options, Component }), () => {})
		},
		get: (name) => (name === "sessions" ? sessions : undefined),
		effect: (fn, label) => {
			const disposer = fn();
			state.effects.push({ label, disposer });
			return disposer;
		}
	};

	const doc = {
		addEventListener: (type, listener) => state.listeners.set(type, listener),
		removeEventListener: (type) => state.listeners.delete(type),
		querySelector: (selector) => {
			if (selector === '[aria-modal="true"]') return modal ? {} : null;
			if (selector === '[role="listbox"],[role="menu"]') return overlay ? {} : null;
			return null;
		}
	};

	globalThis.document = doc;
	client.apply(ctx);
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
	return {
		state,
		doc,
		/** Dispatch one keydown and let the deferred judgement run. */
		key: async (event) => {
			state.listeners.get("keydown")(event);
			await tick();
		}
	};
}

//#region decision function
test("decideEscapeStop refuses every non-stop case with a named reason", () => {
	const session = { sessionId: "s1", getSnapshot: () => ({ running: true, removed: false, subagent: null }) };
	const env = { enabled: true, modalOpen: false, overlayOpen: false, nativeEditorFocused: false, current: { session } };
	const decide = (event, overrides = {}) => client.decideEscapeStop(event, { ...env, ...overrides });
	const reason = (event, overrides = {}) => decide(event, overrides).reason;
	const sessionOf = (snapshot) => ({ current: { session: { getSnapshot: () => snapshot } } });

	assert.deepEqual(decide({ key: "Escape" }), { stop: true, reason: "running", session });
	assert.equal(reason(undefined), "no-event");
	assert.equal(reason({ key: "a" }), "other-key");
	assert.equal(reason({ key: "Escape", repeat: true }), "key-repeat");
	assert.equal(reason({ key: "Escape", ctrlKey: true }), "modifier-held");
	assert.equal(reason({ key: "Escape", shiftKey: true }), "modifier-held");
	assert.equal(reason({ key: "Escape", isComposing: true }), "composing");
	assert.equal(reason({ key: "Escape", defaultPrevented: true }), "already-consumed");
	assert.equal(reason({ key: "Escape" }, { nativeEditorFocused: true }), "native-editor-focused");
	assert.equal(reason({ key: "Escape" }, { modalOpen: true }), "modal-open");
	assert.equal(reason({ key: "Escape" }, { overlayOpen: true }), "overlay-open");
	assert.equal(reason({ key: "Escape" }, { enabled: false }), "disabled");
	assert.equal(reason({ key: "Escape" }, { current: undefined }), "no-current-session");
	assert.equal(reason({ key: "Escape" }, { current: {} }), "no-session-face");
	assert.equal(reason({ key: "Escape" }, { current: { session: {} } }), "no-session-snapshot");
	assert.equal(reason({ key: "Escape" }, sessionOf({ running: true, removed: true, subagent: null })), "session-removed");
	assert.equal(reason({ key: "Escape" }, sessionOf({ running: true, removed: false, subagent: { address: "s0/s1" } })), "subagent-view");
	assert.equal(reason({ key: "Escape" }, sessionOf({ running: false, removed: false, subagent: null })), "not-running");
});
//#endregion

//#region listener wiring
test("Escape while the viewed turn runs cancels through the scoped conversation", async () => {
	const { state, key } = harness();
	await key({ ...ESCAPE });
	assert.deepEqual(state.cancels, ["conversation"]);
});

test("falls back to the session face when the scoped conversation is unavailable", async () => {
	const { state, key } = harness({ conversationAvailable: false });
	await key({ ...ESCAPE });
	assert.deepEqual(state.cancels, ["session"]);
});

test("every refusal keeps the turn running", async () => {
	const cases = [
		["idle session", { running: false }, {}],
		["no current session", { current: null }, {}],
		["subagent view", { subagent: { address: "s0/s1" } }, {}],
		["removed session", { removed: true }, {}],
		["toggle off", { value: { enabled: false } }, {}],
		["key repeat", {}, { repeat: true }],
		["already consumed", {}, { defaultPrevented: true }],
		["modifier held", {}, { metaKey: true }],
		["settings modal open", { modal: true }, {}],
		["list overlay open", { overlay: true }, {}],
		["native editor focused", {}, { target: { tagName: "INPUT" } }],
		["not Escape", {}, { key: "Enter" }]
	];
	for (const [label, options, event] of cases) {
		const { state, key } = harness(options);
		await key({ ...ESCAPE, ...event });
		assert.equal(state.cancels.length, 0, label);
	}
});

test("holding Escape only stops once: repeats are ignored", async () => {
	const { state, key } = harness();
	await key({ key: "Escape" });
	await key({ key: "Escape", repeat: true });
	await key({ key: "Escape", repeat: true });
	assert.deepEqual(state.cancels, ["conversation"]);
});

test("a session lookup failure is contained", async () => {
	const { state, key } = harness({ sessionsBroken: true });
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args);
	await assert.doesNotReject(() => key({ ...ESCAPE }));
	console.warn = originalWarn;
	assert.equal(state.cancels.length, 0);
	assert.equal(warnings.length, 1);
	assert.equal(String(warnings[0][0]).startsWith("[esc-stop]"), true);
});

test("the listener is disposed with the plugin effect", () => {
	const { state } = harness();
	assert.equal(state.listeners.has("keydown"), true);
	const effect = state.effects.find((entry) => entry.label === "esc-stop: escape listener");
	effect.disposer();
	assert.equal(state.listeners.has("keydown"), false);
});
//#endregion

//#region settings row
test("registers one General-settings row bound to the esc-stop namespace", () => {
	const { state } = harness();
	assert.deepEqual(state.bindSpecs, [{ namespace: "esc-stop" }]);
	assert.deepEqual(state.slots, ["settings.general.item"]);
	assert.equal(state.rows.length, 1);
	assert.equal(state.rows[0].options.id, "esc-stop");
	assert.equal(typeof state.rows[0].Component, "function");
});

test("the row's write action persists into the namespace", async () => {
	const { state } = harness();
	const injected = state.rows[0].options.inject({});
	assert.equal(injected.hooks.escStop.getSnapshot().enabled, true);
	injected.setEnabled(false);
	injected.setEnabled(true);
	await Promise.resolve();
	assert.deepEqual(state.writes, [["enabled", false], ["enabled", true]]);
});

test("the row renders from the store snapshot", () => {
	const { state } = harness();
	const store = state.rows[0].options.inject({}).hooks.escStop;
	const tree = state.rows[0].Component({ useEscStop: (selector) => selector(store.getSnapshot()), setEnabled: () => {} });
	assert.equal(tree.type, "div");
	const button = tree.props.children[1];
	assert.equal(button.props.role, "switch");
	assert.equal(button.props["aria-checked"], true);
	assert.equal(button.props.children, "ON");
});

test("an unwritable namespace defaults to ON and disables the switch", () => {
	const { state } = harness({ writable: false });
	const store = state.rows[0].options.inject({}).hooks.escStop;
	assert.equal(store.getSnapshot().enabled, true);
	assert.equal(store.getSnapshot().writable, false);
	const tree = state.rows[0].Component({ useEscStop: (selector) => selector(store.getSnapshot()), setEnabled: () => {} });
	assert.equal(tree.props.children[1].props.disabled, true);

	const off = harness({ value: { enabled: false } });
	const offStore = off.state.rows[0].options.inject({}).hooks.escStop;
	assert.equal(offStore.getSnapshot().enabled, false);
	assert.equal(off.state.rows[0].Component({
		useEscStop: (selector) => selector(offStore.getSnapshot()),
		setEnabled: () => {}
	}).props.children[1].props["aria-checked"], false);
});
//#endregion
