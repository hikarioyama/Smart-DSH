// Standalone functional test harness for dsh-notify-push host half.
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "dsh-notify-home-"));

const hooks = new Map();
const effects = [];
const disposers = [];
const services = new Map();

const fakeWebServer = {
  registered: new Map(),
  register(route) { this.registered.set(route.path, route); return () => this.registered.delete(route.path); }
};

const ctx = {
  on(name, listener, options) {
    const list = hooks.get(name) ?? [];
    if (options?.prepend) list.unshift({ callback: listener, options });
    else list.push({ callback: listener, options });
    hooks.set(name, list);
    const dispose = () => {
      const at = list.findIndex((h) => h.callback === listener);
      if (at !== -1) list.splice(at, 1);
    };
    disposers.push(dispose);
    return dispose;
  },
  effect(fn, label) { const d = fn(); effects.push(label); return d; },
  inject(names, fn) {
    const scope = {
      get: (name) => services.get(name),
      connection: services.get("connection"),
      effect: (e, l) => e(),
      inject: this.inject,
      webServer: fakeWebServer,
      on: (name, listener, options) => ctx.on(name, listener, options)
    };
    fn(scope);
  },
  webServer: fakeWebServer
};

services.set("connection", { requestRejection: (req) => (req.headers.cookie === "ok" ? void 0 : 401) });
services.set("webServer", fakeWebServer);

// The waterfall event: call listeners outermost-first like cordis waterfall.
async function dispatchUserQuestions(request) {
  const list = [...(hooks.get("user-questions/request") ?? [])];
  let index = 0;
  const next = () => {
    const hook = list[index++];
    if (hook === void 0) return Promise.resolve("no-listener");
    return Promise.resolve(hook.callback.call({}, request, next));
  };
  return next();
}

const mod = await import(new URL("../lib/index.js", import.meta.url).href);
mod.apply(ctx);

const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); };

// 1. prepend check: our listener must be outermost (first).
const list = hooks.get("user-questions/request") ?? [];
assert(list.length >= 1, "listener registered");
assert(list[0] !== void 0, "listener present (prepend vs push not distinguishable in fake; dsh ordering verified by { prepend: true } option presence)");
assert(list[0].options?.prepend === true, "listener registered with prepend: true");

// 2. Routes registered.
for (const path of ["/api/push/subscribe", "/api/push/unsubscribe", "/api/push/vapid", "/push/sw.js"]) {
  assert(fakeWebServer.registered.has(path), `route ${path}`);
}

// 3. VAPID key generation + persistence via the vapid route (auth pass).
const vapidRoute = fakeWebServer.registered.get("/api/push/vapid");
const res = capture();
await vapidRoute.handler({ headers: { cookie: "ok" } }, res);
const vapidBody = JSON.parse(res.body);
assert(vapidBody.ok === true && typeof vapidBody.publicKey === "string" && vapidBody.publicKey.length > 40, "vapid public key generated");
const res2 = capture();
await vapidRoute.handler({ headers: {} }, res2);
assert(res2.status === 401, "vapid route rejects unauthenticated");

// 4. subscribe route validation.
const subRoute = fakeWebServer.registered.get("/api/push/subscribe");
const res3 = capture();
await subRoute.handler({ method: "POST", headers: { cookie: "ok" } }, res3).catch(() => {});
// body stream test with real stream:
import { Readable } from "node:stream";
const req4 = Readable.from([Buffer.from(JSON.stringify({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-1", keys: { p256dh: "BPK", auth: "auth1" } }, label: "test-phone" }))]);
req4.headers = { cookie: "ok" };
req4.method = "POST";
const res4 = capture();
await subRoute.handler(req4, res4);
console.log("subscribe res4:", res4.status, res4.body);
const subBody = JSON.parse(res4.body);
assert(subBody.ok === true && subBody.count === 1, "valid subscription stored");
const req5 = Readable.from([Buffer.from(JSON.stringify({ subscription: { endpoint: 123 } }))]);
req5.headers = { cookie: "ok" };
req5.method = "POST";
const res5 = capture();
await subRoute.handler(req5, res5);
assert(res5.status === 400, "invalid subscription rejected");

// 5. push fan-out dispatch: listener must not consume (delegate) — returns next() value.
const outcome = await dispatchUserQuestions({ questions: [{ id: "q1", question: "どちらを選びますか？", header: "選択" }, { id: "q2", question: "もう一つ" }] });
assert(outcome === "no-listener", "waterfall delegated to next() (never consumes)");

// 6. sw.js served with Service-Worker-Allowed header.
const swRoute = fakeWebServer.registered.get("/push/sw.js");
const res6 = capture();
await swRoute.handler({ method: "GET" }, res6);
assert(res6.headers["service-worker-allowed"] === "/" && res6.body.includes("showNotification"), "sw.js served with scope header");


function capture() {
  const state = { headers: {}, body: "", status: 0 };
  return {
    get headers() { return state.headers; },
    get body() { return state.body; },
    get status() { return state.status; },
    writeHead(status, headers) { state.status = status; Object.assign(state.headers, headers ?? {}); },
    end(chunk) { if (typeof chunk === "string") state.body += chunk; }
  };
}
