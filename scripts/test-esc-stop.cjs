// Browser check for dsh-esc-stop against an already-running DSH server.
//
// It injects the shipped listener code into the live page and drives real
// KeyboardEvents against stub sessions, so no real turn is cancelled and no DSH
// process is started or restarted. The login URL is private input, never logged.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright \
//   DSH_LOGIN_URL_FILE=/path/to/private-login-url.txt \
//   node scripts/test-esc-stop.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../dsh-esc-stop/lib/client.js"), "utf8");
const OPEN = "//#region escape decision and listener";
const CLOSE = "//#endregion";
const start = source.indexOf(OPEN);
const end = start === -1 ? -1 : source.indexOf(CLOSE, start);
if (start === -1 || end === -1 || end <= start) {
	console.error("FAIL: could not extract the decision/listener region from lib/client.js");
	process.exit(1);
}
const code = source.slice(start, end);

// The three client services this bundle injects, answered by these shipped rows.
const PROVIDERS = [
	"@deepseek-ai/dsh-api-session-controller",
	"@deepseek-ai/dsh-client-ui-renderer",
	"@deepseek-ai/dsh-client-ui-settings"
];

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await context.newPage();
	await page.goto(fs.readFileSync(process.env.DSH_LOGIN_URL_FILE, "utf8").trim());
	await page.waitForFunction(() => globalThis.__DSH_BOOT__ !== undefined, null, { timeout: 30000 });
	await page.waitForSelector(".pI_x6G_centerCol", { timeout: 30000 });
	await page.waitForTimeout(500);

	const composition = await page.evaluate((providers) => {
		const graph = JSON.stringify(globalThis.__DSH_BOOT__ ?? {});
		return providers.map((id) => ({ id, present: graph.includes(id) }));
	}, PROVIDERS);

	const outcome = await page.evaluate(async (block) => {
		const api = new Function(`${block}\nreturn { decideEscapeStop, installEscapeStop };`)();
		const failures = [];
		const cancels = [];
		const check = (name, condition, detail) => {
			if (!condition) failures.push(`${name}${detail === undefined ? "" : ` (${detail})`}`);
		};

		const snapshot = { running: true, removed: false, subagent: null };
		const session = {
			sessionId: "s1",
			getSnapshot: () => snapshot,
			cancel: () => {
				cancels.push("session");
				return Promise.resolve({ ok: true });
			}
		};
		const ctx = {
			get: (name) => name === "sessions" ? {
				list: { getSnapshot: () => ({ current: "s1", byId: { s1: { running: snapshot.running } } }) },
				binding: (id) => id === "s1" ? { sessionId: id, session } : undefined,
				scope: (id) => id === "s1" ? {
					get: (service) => service === "conversation" ? {
						cancel: () => {
							cancels.push("conversation");
							return Promise.resolve({ ok: true });
						}
					} : undefined
				} : undefined
			} : undefined
		};

		let enabled = true;
		const dispose = api.installEscapeStop(ctx, () => enabled, document);
		// The shipped listener judges one microtask after capture, so dispatch and
		// let that judgement (and the composer's own handlers) settle.
		const press = async (options = {}, target = document.body) => {
			const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...options });
			target.dispatchEvent(event);
			await new Promise((resolve) => setTimeout(resolve, 0));
			return event;
		};
		const count = () => cancels.length;

		// 1. Real keydown on the live document stops the running turn.
		await press();
		check("escape-cancels", count() === 1 && cancels[0] === "conversation", `cancels=${count()}`);

		// 2. An idle session ignores Escape.
		snapshot.running = false;
		await press();
		check("idle-no-cancel", count() === 1);
		snapshot.running = true;

		// 3. The durable toggle off ignores Escape.
		enabled = false;
		await press();
		check("disabled-no-cancel", count() === 1);
		enabled = true;

		// 4. Key repeat (holding the key) stops once.
		await press({ repeat: true });
		check("repeat-no-cancel", count() === 1);

		// 5. Modifier chords belong to the browser.
		await press({ metaKey: true });
		await press({ ctrlKey: true });
		check("modifier-no-cancel", count() === 1);

		// 6. An open modal (the settings panel) owns Escape.
		const modal = document.createElement("div");
		modal.setAttribute("aria-modal", "true");
		document.body.appendChild(modal);
		await press();
		check("modal-no-cancel", count() === 1);
		modal.remove();

		// 7. A native text field owns Escape (queue edit).
		const input = document.createElement("input");
		document.body.appendChild(input);
		await press({}, input);
		check("input-no-cancel", count() === 1);
		input.remove();

		// 8. An open list surface (command menu, popupSelect) owns Escape.
		const listbox = document.createElement("div");
		listbox.setAttribute("role", "listbox");
		document.body.appendChild(listbox);
		await press();
		check("overlay-no-cancel", count() === 1);
		listbox.remove();

		// 9. A key the composer already consumed is left alone.
		const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		consumed.preventDefault();
		document.body.dispatchEvent(consumed);
		await new Promise((resolve) => setTimeout(resolve, 0));
		check("consumed-no-cancel", count() === 1);

		// 10. Another Escape still stops (the guards are per-event, not sticky).
		await press();
		check("second-escape-cancels", count() === 2);

		// 11. Disposal removes the listener.
		dispose();
		snapshot.running = true;
		await press();
		check("disposed-no-cancel", count() === 2);

		// 12. The pure decision carries a named reason for a refusal.
		const refused = api.decideEscapeStop({ key: "Escape", repeat: true }, {
			enabled: true,
			modalOpen: false,
			nativeEditorFocused: false,
			current: { session }
		});
		check("reason-named", refused.stop === false && refused.reason === "key-repeat", refused.reason);

		return { failures, cancels };
	}, code);

	// 12. The whole shipped bundle parses and registers in the live page: the
	// ModuleLoader facade accepts it and no page error is raised.
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(String(error)));
	await page.addScriptTag({ content: source });
	await page.waitForTimeout(200);
	const loader = await page.evaluate(() => ({
		mode: window.__ModuleLoader__?.mode,
		hasLoad: typeof window.__ModuleLoader__?.load === "function"
	}));

	await context.close();
	await browser.close();

	let failed = false;
	for (const provider of composition) {
		const ok = provider.present;
		if (!ok) failed = true;
		console.log(`${ok ? "PASS" : "FAIL"} composition contains ${provider.id}`);
	}
	if (outcome.failures.length === 0) {
		console.log(`PASS all 12 in-page gestures (cancels=${outcome.cancels.length})`);
	} else {
		failed = true;
		for (const failure of outcome.failures) console.log(`FAIL ${failure}`);
	}
	if (pageErrors.length === 0 && loader.hasLoad) {
		console.log(`PASS shipped bundle parsed and registered (mode=${String(loader.mode)})`);
	} else {
		failed = true;
		for (const error of pageErrors) console.log(`FAIL page error: ${error}`);
		if (!loader.hasLoad) console.log("FAIL ModuleLoader facade missing");
	}
	process.exit(failed ? 1 : 0);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
