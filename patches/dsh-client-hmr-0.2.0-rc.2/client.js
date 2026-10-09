window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-hmr",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region lib/types/events.js
		/**
		* Wire protocol of the `/plugins/events` SSE channel — single source for
		* both halves of this package. Frames still cross a wire boundary: the
		* browser half validates them at its JSON parse point; sharing the type keeps
		* the two ends from drifting, not from parsing.
		*/
		/**
		* Validate the frame envelope; the module controller parses the complete graph before updating its index.
		* @param value - Parsed JSON value from the EventSource message.
		* @returns the known frame, an unknown-type marker, or an invalid marker.
		*/
		function parsePluginsEventFrame(value) {
			if (typeof value !== "object" || value === null) return { kind: "invalid" };
			const record = value;
			switch (record.type) {
				case "rebuilt": return typeof record.id === "string" && typeof record.rev === "string" ? {
					kind: "frame",
					frame: {
						type: "rebuilt",
						id: record.id,
						rev: record.rev
					}
				} : { kind: "invalid" };
				case "graph": return typeof record.graph === "object" && record.graph !== null ? {
					kind: "frame",
					frame: {
						type: "graph",
						graph: record.graph
					}
				} : { kind: "invalid" };
				default: return typeof record.type === "string" ? { kind: "unknown" } : { kind: "invalid" };
			}
		}
		/**
		* Document-relative form of {@link EVENTS_ENDPOINT} used by the browser half.
		* See .agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md.
		*/
		const EVENTS_ROUTE = "/plugins/events".slice(1);
		//#endregion
		//#region lib/types/client/index.js
		/** Share optional HMR's HTTP/1 SSE slot across tabs of the same origin. */
		function subscribeSharedPluginEvents(onData, logger) {
			const locks = globalThis.navigator?.locks;
			if (typeof globalThis.BroadcastChannel !== "function" || locks === void 0) {
				logger.warn("client-hmr: optional live reload needs BroadcastChannel and Web Locks; skipping the dev stream");
				return () => {};
			}
			const endpoint = new URL(EVENTS_ROUTE, document.baseURI).href;
			const key = `dsh:client-hmr:${endpoint}:v2`;
			const channel = new BroadcastChannel(key);
			const abort = new AbortController();
			let disposed = false;
			let finish;
			const lifetime = new Promise((resolve) => { finish = resolve; });
			const receive = (data) => {
				if (!disposed && typeof data === "string") onData(data);
			};
			channel.addEventListener("message", (event) => receive(event.data));
			// One owner holds the lock for its lifetime. Closing that tab or
			// disposing this plugin releases it, so a waiting tab takes over.
			void locks.request(key, { signal: abort.signal }, async () => {
				if (disposed) return;
				const source = new EventSource(endpoint);
				source.addEventListener("message", (event) => {
					if (disposed) return;
					receive(event.data);
					channel.postMessage(event.data);
				});
				try {
					await lifetime;
				} finally {
					source.close();
				}
			}).catch((error) => {
				if (!disposed) logger.warn("client-hmr: shared dev stream failed", error);
			});
			return () => {
				if (disposed) return;
				disposed = true;
				abort.abort();
				finish();
				channel.close();
			};
		}
		/** Cordis plugin name. */
		const name = "client-hmr";
		/** Required service: the client module system whose entry controller handles received frames. */
		const inject = ["modules"];
		/**
		* Forward graph snapshots and rebuilds to the page's shared serial controller.
		* @param ctx - Plugin context with the client module system.
		*/
		function apply(ctx) {
			const entries = ctx.modules.entries;
			const handle = (frame) => {
				(frame.type === "graph" ? Promise.resolve().then(() => entries.sync(frame.graph)) : entries.reload(frame.id, frame.rev)).catch((error) => {
					ctx.logger.error(error);
				});
			};
			ctx.effect(() => subscribeSharedPluginEvents((data) => {
				let value;
				try { value = JSON.parse(data); }
				catch { ctx.logger.warn(`client-hmr: unparseable event frame: ${data}`); return; }
				const parsed = parsePluginsEventFrame(value);
				if (parsed.kind === "invalid") ctx.logger.warn(`client-hmr: invalid event frame: ${data}`);
				else if (parsed.kind === "frame") handle(parsed.frame);
			}, ctx.logger), "client-hmr: shared event source");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map