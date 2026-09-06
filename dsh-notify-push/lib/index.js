import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, openSync, fstatSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE_DIR = join(process.env.DSH_HOME ?? join(process.env.HOME ?? "", ".dsh"), "notify-push");
const VAPID_PATH = join(STATE_DIR, "vapid.json");
const SUBSCRIPTIONS_PATH = join(STATE_DIR, "subscriptions.json");

const PUSH_TTL_SECONDS = 3600;

/** Atomic JSON write with 0600 permissions (temp file + rename, like dsh-atomic-write). */
function atomicWriteJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	const fd = openSync(tmp, "w", 0o600);
	try {
		writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
		fstatSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tmp, path);
}

function readJson(path, fallback) {
	if (!existsSync(path)) return fallback;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return fallback;
	}
}

let webPush;
/** Lazily import web-push (dynamic import keeps startup free of the dep). */
const loadWebPush = async () => {
	if (webPush === void 0) webPush = (await import("web-push")).default;
	return webPush;
};
/** Lazy single-flight VAPID key load; keys persist across restarts. */
let vapidMemo;
async function getVapid() {
	if (vapidMemo !== void 0) return vapidMemo;
	const existing = readJson(VAPID_PATH, null);
	if (existing !== null && typeof existing.publicKey === "string" && typeof existing.privateKey === "string") {
		vapidMemo = existing;
		return vapidMemo;
	}
	vapidMemo = await (await loadWebPush()).generateVAPIDKeys();
	atomicWriteJson(VAPID_PATH, vapidMemo);
	return vapidMemo;
}

function loadSubscriptions() {
	const list = readJson(SUBSCRIPTIONS_PATH, []);
	return Array.isArray(list) ? list : [];
}

function saveSubscriptions(list) {
	atomicWriteJson(SUBSCRIPTIONS_PATH, list);
}

/** Build the notification payload for one root-session turn end. */
function buildTurnEndPayload(sessionId, reason) {
	const kind = typeof reason?.kind === "string" ? reason.kind : "unknown";
	const titles = {
		completed: "DSH: 作業完了",
		"max-tokens": "DSH: 作業完了 (トークン上限で切り詰め)",
		blocked: "DSH: 停止 (要求が拒否されました)",
		error: "DSH: エラーで停止",
		aborted: "DSH: 停止 (中断されました)"
	};
	const title = titles[kind] ?? `DSH: ターン終了 (${kind})`;
	const body = kind === "completed" ? "作業が完了しました。結果を確認してください。" : `終了理由: ${kind}`;
	return { title, body, url: `/?session=${encodeURIComponent(sessionId)}` };
}

/** Build the notification payload from one forwarded user-questions request. */
function buildPayload(request) {
	const questions = Array.isArray(request?.questions) ? request.questions : [];
	const first = questions[0] ?? {};
	const header = typeof first.header === "string" && first.header.length > 0 ? first.header : "選択肢";
	const questionText = typeof first.question === "string" ? first.question : "";
	const extra = questions.length > 1 ? `（他 ${questions.length - 1} 件）` : "";
	return {
		title: `DSH: ${header}${extra}`,
		body: questionText,
		url: "/"
	};
}

/**
 * Host half: HTTP routes for the service worker and push subscriptions, plus a
 * prepended `user-questions/request` waterfall listener that fans out Web Push.
 * Never answers the waterfall — every path calls `next()`.
 */
function apply(ctx) {
	let vapid;
	const ensureVapid = async () => {
		if (vapid === void 0) vapid = await getVapid();
		return vapid;
	};
	const configure = async () => {
		const vapidKeys = await ensureVapid();
		const push = await loadWebPush();
		push.setVapidDetails("mailto:root@localhost", vapidKeys.publicKey, vapidKeys.privateKey);
		return push;
	};

	async function sendPushToAll(frame) {
		const subscriptions = loadSubscriptions();
		if (subscriptions.length === 0) return;
		let push;
		try {
			push = await configure();
		} catch (error) {
			console.error("notify-push: web-push init failed", error);
			return;
		}
		const stale = [];
		await Promise.allSettled(subscriptions.map(async (entry) => {
			try {
				await push.sendNotification(entry.subscription, JSON.stringify(frame), { TTL: PUSH_TTL_SECONDS });
			} catch (error) {
				const status = error?.statusCode;
				if (status === 404 || status === 410) {
					stale.push(entry.endpoint);
					return;
				}
				console.error("notify-push: sendNotification failed", status ?? error);
			}
		}));
		if (stale.length > 0) {
			saveSubscriptions(loadSubscriptions().filter((entry) => !stale.includes(entry.endpoint)));
		}
	}

	ctx.inject(["agents"], (agentCtx) => {
		const agents = agentCtx.get("agents");
		agentCtx.on("session/event", (session, event) => {
			if (event?.type !== "turn/end") return;
			// Root (top-level) sessions only: a subagent finishing must not notify.
			const agent = agents?.get(session.id);
			if (agent === void 0 || !agents.roots().includes(agent)) return;
			void sendPushToAll(buildTurnEndPayload(session.id, event.data?.reason)).catch((error) => {
				console.error("notify-push: turn-end push failed", error);
			});
		});
	});

	ctx.effect(() => ctx.on("user-questions/request", function(request, next) {
		// Outermost listener (prepended): fire-and-forget push, then delegate.
		void sendPushToAll(buildPayload(request)).catch((error) => {
			console.error("notify-push: push fan-out failed", error);
		});
		return next();
	}, { prepend: true }), "notify-push: user-questions push fan-out");

	const swBody = readFileSync(join(PACKAGE_ROOT, "sw", "sw.js"), "utf8");

	ctx.inject(["connection", "webServer"], (routeCtx) => {
		const connection = routeCtx.connection;
		const json = (res, status, value) => {
			const body = JSON.stringify(value);
			res.writeHead(status, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(body);
		};
		const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on("data", (chunk) => {
				size += chunk.length;
				if (size > limit) {
					reject(Object.assign(new Error("body too large"), { statusCode: 413 }));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
		const authed = (req) => connection.requestRejection(req);

		const subscribeRoute = {
			kind: "exact",
			path: "/api/push/subscribe",
			handler: async (req, res) => {
				const rejection = authed(req);
				if (rejection !== void 0) {
					res.writeHead(rejection);
					res.end(rejection === 401 ? "unauthorized" : "forbidden");
					return;
				}
				if (req.method !== "POST") {
					res.writeHead(405, { allow: "POST" });
					res.end();
					return;
				}
				try {
					const body = JSON.parse(await readBody(req));
					const subscription = body?.subscription;
					if (typeof subscription?.endpoint !== "string" || typeof subscription?.keys?.p256dh !== "string" || typeof subscription?.keys?.auth !== "string") {
						json(res, 400, { ok: false, error: "invalid subscription" });
						return;
					}
					const list = loadSubscriptions().filter((entry) => entry.endpoint !== subscription.endpoint);
					list.push({
						endpoint: subscription.endpoint,
						subscription,
						label: typeof body.label === "string" ? body.label.slice(0, 80) : "",
						userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : "",
						createdAt: new Date().toISOString()
					});
					saveSubscriptions(list);
					json(res, 200, { ok: true, count: list.length });
				} catch (error) {
					json(res, error?.statusCode ?? 400, { ok: false, error: String(error?.message ?? error) });
				}
			}
		};
		const unsubscribeRoute = {
			kind: "exact",
			path: "/api/push/unsubscribe",
			handler: async (req, res) => {
				const rejection = authed(req);
				if (rejection !== void 0) {
					res.writeHead(rejection);
					res.end(rejection === 401 ? "unauthorized" : "forbidden");
					return;
				}
				if (req.method !== "POST") {
					res.writeHead(405, { allow: "POST" });
					res.end();
					return;
				}
				try {
					const body = JSON.parse(await readBody(req));
					const endpoint = body?.endpoint;
					if (typeof endpoint !== "string") {
						json(res, 400, { ok: false, error: "invalid endpoint" });
						return;
					}
					const list = loadSubscriptions();
					const remaining = list.filter((entry) => entry.endpoint !== endpoint);
					saveSubscriptions(remaining);
					json(res, 200, { ok: true, removed: list.length - remaining.length });
				} catch (error) {
					json(res, error?.statusCode ?? 400, { ok: false, error: String(error?.message ?? error) });
				}
			}
		};
		const vapidRoute = {
			kind: "exact",
			path: "/api/push/vapid",
			handler: async (req, res) => {
				const rejection = authed(req);
				if (rejection !== void 0) {
					res.writeHead(rejection);
					res.end(rejection === 401 ? "unauthorized" : "forbidden");
					return;
				}
				json(res, 200, { ok: true, publicKey: (await ensureVapid()).publicKey });
			}
		};
		const swRoute = {
			kind: "exact",
			path: "/push/sw.js",
			handler: async (req, res) => {
				// Static, secret-free; wider scope declared for the PWA root.
				res.writeHead(200, {
					"content-type": "text/javascript; charset=utf-8",
					"cache-control": "no-cache",
					"service-worker-allowed": "/"
				});
				res.end(req.method === "HEAD" ? void 0 : swBody);
			}
		};
		routeCtx.effect(() => {
			const disposers = [routeCtx.webServer.register(subscribeRoute), routeCtx.webServer.register(unsubscribeRoute), routeCtx.webServer.register(vapidRoute), routeCtx.webServer.register(swRoute)];
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "notify-push: push routes");
	});
}

//#endregion
export { apply };
