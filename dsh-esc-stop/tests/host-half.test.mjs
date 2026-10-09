import { test } from "node:test";
import assert from "node:assert/strict";
import { Config, apply } from "../lib/index.js";

test("exports the loader configuration with an ON default", () => {
	assert.equal(Config({}).enabled.get(), true);
	assert.equal(Config({ enabled: false }).enabled.get(), false);
	assert.equal(Config({ enabled: true }).enabled.get(), true);
	assert.equal(Config.dict.enabled.meta.volatile, true);
});

test("disables the duplicate automatic form on the owning fiber", () => {
	const fiber = {};
	const calls = [];
	const dispose = () => {};
	const child = {
		settings: { configure: (...args) => (calls.push(args), dispose) },
		effect: (fn) => assert.equal(fn(), dispose)
	};
	apply({ fiber, inject: (names, fn) => {
		assert.deepEqual(names, ["settings"]);
		fn(child);
	} });
	assert.deepEqual(calls, [[{ auto: false }, fiber]]);
});
