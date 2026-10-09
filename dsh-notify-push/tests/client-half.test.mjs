import assert from "node:assert/strict";
import test from "node:test";

let client;
globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => { throw Error("unexpected require"); }); } } };
await import("../lib/client.js");

test("notification contribution uses current callable copy and popup option details", async () => {
	let contribution;
	const commandUi = { register: (spec) => { contribution = spec; return () => {}; } };
	const ctx = {
		remote: { $prependListener: () => () => {}, $on: () => () => {} },
		effect: (fn) => fn(),
		inject: (_names, fn) => fn({ get: () => commandUi, effect: (effect) => effect() })
	};
	client.apply(ctx);
	assert.equal(contribution.name, "notify");
	assert.equal(typeof contribution.description(), "string");
	const options = await contribution.ui.options();
	assert.deepEqual(options.map(option => option.id), ["on", "off"]);
	assert.ok(options.every(option => typeof option.detail === "string"));
});
