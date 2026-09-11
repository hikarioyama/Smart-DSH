// Host-half checks for dsh-esc-stop: the settings namespace it registers.
import { test } from "node:test";
import assert from "node:assert/strict";

const registered = [];
const mod = await import("../lib/index.js");

/** Minimal settings provider: records registrations. */
function provider() {
	return {
		settings: {
			register(ns, schema) {
				registered.push({ ns, schema });
				return { get: () => ({}), watch: () => () => {} };
			}
		}
	};
}

/** Run `fn` with console.warn captured, so contained failures stay asserted. */
function captureWarnings(fn) {
	const warnings = [];
	const original = console.warn;
	console.warn = (...args) => warnings.push(args);
	try {
		fn();
	} finally {
		console.warn = original;
	}
	return warnings;
}

test("registers the esc-stop namespace with an ON default", () => {
	mod.apply({ inject: (_names, fn) => fn(provider()) });
	assert.equal(registered.length, 1);
	const { ns, schema } = registered[0];
	assert.equal(ns, "esc-stop");
	assert.equal(schema({}).enabled, true);
	assert.equal(schema({ enabled: false }).enabled, false);
	assert.equal(schema({ enabled: true }).enabled, true);
});

test("an absent settings service never throws", () => {
	const warnings = captureWarnings(() => {
		assert.doesNotThrow(() => mod.apply({ inject: (_names, fn) => fn({}) }));
	});
	assert.equal(warnings.length, 1);
	assert.equal(String(warnings[0][0]).startsWith("[esc-stop]"), true);
});

test("a duplicate registration never throws", () => {
	const warnings = captureWarnings(() => {
		assert.doesNotThrow(() => mod.apply({
			inject: (_names, fn) => fn({ settings: { register: () => { throw new Error("duplicate"); } } })
		}));
	});
	assert.equal(warnings.length, 1);
});
