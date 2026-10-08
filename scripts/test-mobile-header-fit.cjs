// Browser check for the phone header fit against an already-running DSH server.
//
// It injects the shipped mobile-rail CSS from dsh-notify-push/lib/client.js into the live page and
// measures the real session header, so no DSH process is started or restarted and no turn is sent.
// The login URL is private input, never logged.
//
// Selectors carry DSH's build-scoped CSS-module hashes (0.1.5-rc.3), the same convention the other
// mobile checks use. Re-derive them when a DSH upgrade makes MISSING report every row.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright \
//   DSH_LOGIN_URL_FILE=/path/to/private-login-url.txt \
//   node scripts/test-mobile-header-fit.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../dsh-notify-push/lib/client.js"), "utf8");
const start = source.indexOf("function installMobileRail(ctx)");
const end = start === -1 ? -1 : source.indexOf("\t\tfunction apply(ctx)", start);
if (start === -1 || end === -1 || end <= start) {
	console.error("FAIL: could not extract the mobile rail region from lib/client.js");
	process.exit(1);
}
const code = source.slice(start, end);

const PHONE_WIDTHS = [360, 390, 412, 767];
const DESKTOP_WIDTH = 1280;
const SELECTORS = { header: ".wSkVaW_header", preset: ".SVAs4q_label", pill: ".QsffPG_trigger", corner: ".wSkVaW_headerCorner" };

(async () => {
	const browser = await chromium.launch({ headless: true });
	const failures = [];
	for (const width of [...PHONE_WIDTHS, DESKTOP_WIDTH]) {
		const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768 });
		const page = await context.newPage();
		await page.goto(fs.readFileSync(process.env.DSH_LOGIN_URL_FILE, "utf8").trim());
		await page.waitForFunction(() => globalThis.__DSH_BOOT__ !== undefined, null, { timeout: 30000 });
		await page.waitForSelector(".pI_x6G_centerCol", { timeout: 30000 });
		await page.waitForTimeout(600);

		// Test the repo's CSS, not whatever the server happens to serve.
		await page.evaluate(() => {
			document.querySelectorAll("style[data-smart-dsh-mobile]").forEach((node) => node.remove());
		});
		await page.evaluate((block) => {
			(0, eval)(`${block}; installMobileRail({ effect(fn) { window.__railCleanup = fn(); } })`);
		}, code);

		// A phone starts with the rail collapsed, a desktop with the sidebar open; open only when needed.
		const wasCollapsed = await page.evaluate(() => {
			const toggle = document.querySelector(".hHd-Xa_toggle");
			const collapsed = document.querySelector("[data-sidebar-collapsed]") !== null;
			if (collapsed && toggle) toggle.click();
			return collapsed;
		});
		await page.waitForTimeout(900);
		const picked = await page.evaluate(() => {
			const rows = [...document.querySelectorAll('[role="treeitem"]')].filter((row) => !/_projectRow$/.test((row.className || "").toString()));
			if (!rows[0]) return false;
			rows[0].click();
			return true;
		});
		await page.waitForTimeout(2500);
		if (width < 768 && wasCollapsed) {
			await page.evaluate(() => document.querySelector(".hHd-Xa_toggle")?.click());
			await page.waitForTimeout(900);
		}

		const m = await page.evaluate((selectors) => {
			const preset = document.querySelector(`${selectors.header} ${selectors.preset}`);
			const pill = document.querySelector(`${selectors.header} ${selectors.pill}`);
			const corner = document.querySelector(selectors.corner);
			const pillBox = pill ? pill.getBoundingClientRect() : null;
			const cornerBox = corner ? corner.getBoundingClientRect() : null;
			return {
				headerPresent: !!document.querySelector(selectors.header),
				presetPresent: !!preset,
				presetShown: preset ? getComputedStyle(preset).display !== "none" : null,
				pillPresent: !!pill,
				overlapPx: pillBox && cornerBox ? +Math.max(0, pillBox.right - cornerBox.x).toFixed(1) : null,
				offscreenPx: pillBox ? +Math.max(0, pillBox.right - innerWidth).toFixed(1) : null
			};
		}, SELECTORS);

		const problems = [];
		if (!m.headerPresent) problems.push("MISSING session header (pinned selector)");
		if (width < 768) {
			if (m.presetShown === true) problems.push("preset label still shown on a phone");
			if (m.overlapPx !== null && m.overlapPx > 0) problems.push(`jobs pill overlaps the corner toggle by ${m.overlapPx}px`);
			if (m.offscreenPx !== null && m.offscreenPx > 0) problems.push(`jobs pill is ${m.offscreenPx}px past the viewport`);
		} else if (picked && m.presetShown === false) {
			problems.push("preset label hidden on the desktop");
		}
		if (problems.length) failures.push(`${width}px: ${problems.join("; ")}`);
		const presetText = m.presetPresent ? `preset=${String(m.presetShown)}` : "preset=not-found (skip)";
		console.log(`${problems.length ? "FAIL" : "PASS"} ${width}px ${presetText} ` +
			(m.pillPresent ? `pill overlap=${m.overlapPx}px offscreen=${m.offscreenPx}px` : "pill=absent") +
			(picked ? "" : " (no session row; pill check skipped)"));
		await context.close();
	}
	await browser.close();

	if (failures.length) {
		for (const failure of failures) console.log(`FAIL ${failure}`);
		process.exit(1);
	}
	console.log(`PASS header fits at ${[...PHONE_WIDTHS, DESKTOP_WIDTH].join(", ")} px`);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
