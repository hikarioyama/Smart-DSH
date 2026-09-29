window.__ModuleLoader__.load({
	id: "dsh-tasks",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const jsxRuntime = require("react/jsx-runtime");
		const react = require("react");
		const VIEW_ID = "subagents";
		const POLL_MS = 2000;

		/**
		 * Empty-state copy. Off and never-started stay distinct. History is not emptiness.
		 * @param {"off" | "none" | null} empty
		 * @returns {string | null}
		 */
		const USAGE = "usage: /subagents on|off|status";

		function emptyLabel(empty) {
			if (empty === "loading") return "reading session state";
			if (empty === "unread") return "could not read session state";
			if (empty === "off" || empty === "none") return USAGE;
			return null;
		}

		/**
		 * @param {{ empty?: "off" | "none" | null, live?: object[], history?: object[], hub?: object[] }} view
		 * @returns {string[]}
		 */
		function statusRows(view) {
			const rows = new Map();
			for (const row of view?.history ?? []) {
				if (row.kind !== "spawn" || row.childId === undefined || row.childId === null || row.childId === "") continue;
				rows.set(row.childId, { id: row.childId, role: row.role ?? "", label: row.label ?? "", active: false });
			}
			for (const row of view?.live ?? []) {
				if (row.id === undefined || row.id === null || row.id === "") continue;
				const prev = rows.get(row.id);
				rows.set(row.id, {
					id: row.id,
					role: row.role ?? prev?.role ?? "",
					label: row.label ?? prev?.label ?? "",
					active: row.status !== "gone"
				});
			}
			for (const row of view?.history ?? []) {
				if (row.kind === "end" && row.childId) {
					const prev = rows.get(row.childId);
					rows.set(row.childId, {
						id: row.childId,
						role: row.role ?? prev?.role ?? "",
						label: prev?.label ?? row.label ?? "",
						active: false
					});
				} else if (row.kind === "reject") {
					const id = `reject:${row.role ?? ""}:${rows.size}`;
					rows.set(id, { id, role: row.role ?? "rejected", label: "", active: false });
				}
			}
			return [...rows.values()];
		}

		function linesFor(view) {
			const rows = statusRows(view);
			const label = emptyLabel(view?.empty ?? null);
			if (rows.length === 0 && label !== null) return [label];
			return rows.map((row) => `${row.active ? "green" : "red"} ${row.role} ${row.label}`.trim());
		}

		function SubagentsView(props) {
			const useStore = props.useOmpTasks;
			const view = useStore((state) => state.view);
			react.useEffect(() => {
				let stopped = false;
				const tick = () => {
					Promise.resolve(props.load()).then((next) => {
						if (!stopped && next !== undefined && next !== null) props.setView(next);
					}).catch(() => {
						if (!stopped) props.setView({ enabled: false, empty: "unread", live: [], history: [], hub: [] });
					});
				};
				tick();
				const timer = setInterval(tick, POLL_MS);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [props.sessionId]);
			const label = emptyLabel(view?.empty ?? "off");
			const extra = label === USAGE ? null : label;
			const rows = statusRows(view);
			return jsxRuntime.jsxs("div", {
				"data-tasks": "subagent",
				style: {
					height: "100%",
					overflow: "auto",
					padding: "16px 20px",
					color: "var(--dsw-alias-label-primary)",
					font: "inherit",
					fontSize: "13px",
					lineHeight: "20px"
				},
				children: [
					jsxRuntime.jsx("div", { style: { marginBottom: "12px", color: "var(--dsw-alias-label-tertiary)" }, children: USAGE }),
					extra !== null ? jsxRuntime.jsx("div", { children: extra }) : null,
					...rows.map((row) => jsxRuntime.jsxs("div", {
						"data-tasks-open": "no",
						style: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 0" },
						children: [
							jsxRuntime.jsx("span", {
								"data-tasks-dot": row.active ? "green" : "red",
								"aria-label": row.active ? "active" : "stopped",
								style: {
									width: "8px",
									height: "8px",
									borderRadius: "999px",
									background: row.active ? "#3DDC97" : "#FF5A5A",
									flex: "0 0 auto"
								}
							}),
							jsxRuntime.jsx("span", { children: `${row.role} ${row.label}`.trim() })
						]
					}, row.id))
				]
			});
		}

		function modelName(catalog, route) {
			const wanted = route ?? catalog?.current ?? null;
			if (wanted === null) return "model";
			for (const group of catalog?.groups ?? []) {
				if (group.id !== wanted.provider) continue;
				const found = (group.models ?? []).find((item) => item.id === wanted.model);
				if (found) return found.name || found.id;
			}
			return wanted.model || "model";
		}

		function seatCopy(view, catalog) {
			if (view?.enabled !== true) return null;
			return { sub: `sub: ${modelName(catalog, view.subModel ?? null)}`, main: "main:" };
		}

		const emptyCatalog = { current: null, groups: [] };
		const subscribeNothing = () => () => {};

		function SubModelSeat(props) {
			const view = props.useOmpTasks((state) => state.view);
			const catalogStore = props.directory?.store;
			const catalog = react.useSyncExternalStore(
				catalogStore?.subscribe ?? subscribeNothing,
				catalogStore?.getSnapshot ?? (() => emptyCatalog)
			);
			const [open, setOpen] = react.useState(false);
			react.useEffect(() => {
				let stopped = false;
				const tick = () => {
					Promise.resolve(props.load()).then((next) => {
						if (!stopped && next) props.setView(next);
					}).catch(() => {});
				};
				tick();
				const timer = setInterval(tick, POLL_MS);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [props.sessionId]);
			const copy = seatCopy(view, catalog);
			if (copy === null) return null;
			const choices = (catalog?.groups ?? []).flatMap((group) => (group.models ?? []).map((model) => ({
				provider: group.id,
				model: model.id,
				name: model.name || model.id
			})));
			const pick = (route) => {
				setOpen(false);
				Promise.resolve(props.save(route)).then((next) => {
					if (next) props.setView(next);
				}).catch(() => {});
			};
			return jsxRuntime.jsxs("div", {
				"data-tasks-sub-model": "on",
				style: { display: "flex", alignItems: "center", gap: "8px", position: "relative" },
				children: [
					jsxRuntime.jsx("button", {
						type: "button",
						"aria-label": "sub model",
						"aria-haspopup": "menu",
						"aria-expanded": open,
						onClick: () => {
							setOpen((value) => !value);
							props.directory?.load?.()?.catch?.(() => {});
						},
						style: {
							border: "0",
							background: "transparent",
							color: "var(--dsw-alias-label-secondary, inherit)",
							font: "inherit",
							fontSize: "13px",
							padding: "0 2px",
							cursor: "pointer"
						},
						children: copy.sub
					}),
					open ? jsxRuntime.jsxs("div", {
						role: "menu",
						"aria-label": "sub model",
						style: {
							position: "absolute",
							right: "0",
							bottom: "100%",
							marginBottom: "8px",
							minWidth: "220px",
							maxHeight: "240px",
							overflow: "auto",
							zIndex: 40,
							padding: "6px",
							background: "var(--dsw-alias-bg-elevated, #1c1c1c)",
							border: "1px solid var(--dsw-alias-border, #333)",
							borderRadius: "8px"
						},
						children: [
							jsxRuntime.jsx("button", {
								type: "button",
								role: "menuitem",
								onClick: () => pick(null),
								style: { display: "block", width: "100%", textAlign: "left", border: "0", background: "transparent", color: "inherit", font: "inherit", fontSize: "13px", padding: "6px 8px", cursor: "pointer" },
								children: "same as main"
							}),
							...choices.map((choice) => jsxRuntime.jsx("button", {
								type: "button",
								role: "menuitem",
								onClick: () => pick({ provider: choice.provider, model: choice.model }),
								style: { display: "block", width: "100%", textAlign: "left", border: "0", background: "transparent", color: "inherit", font: "inherit", fontSize: "13px", padding: "6px 8px", cursor: "pointer" },
								children: choice.name
							}, `${choice.provider}/${choice.model}`))
						]
					}) : null,
					jsxRuntime.jsx("span", {
						"data-tasks-main-label": "yes",
						style: { color: "var(--dsw-alias-label-secondary, inherit)", fontSize: "13px" },
						children: copy.main
					})
				]
			});
		}

		const inject = ["slots", "sessions", "uiConversation"];

		function apply(ctx) {
			const stores = new Map();
			const storeFor = (sessionId) => {
				let store = stores.get(sessionId);
				if (store === undefined) {
					const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
					store = createSnapshotStore({ view: { enabled: false, empty: "loading", live: [], history: [], hub: [] } });
					stores.set(sessionId, store);
				}
				return store;
			};
			try {
				ctx.uiConversation.views.register({
					target: VIEW_ID,
					create: () => ({
						replace() { return { kind: VIEW_ID }; },
						apply() { return { kind: VIEW_ID }; }
					})
				});
			} catch (error) {
				console.warn("[tasks] view target registration failed", error);
			}
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: VIEW_ID,
				order: 20,
				label: () => "subagent",
				inject: (sessionId) => ({
					hooks: { ompTasks: storeFor(sessionId) },
					sessionId,
					setView: (view) => storeFor(sessionId).set({ view }),
					load: async () => {
						const response = await fetch(`/api/tasks/view?session=${encodeURIComponent(sessionId)}`, { credentials: "same-origin" });
						if (!response.ok) throw new Error(`tasks view ${response.status}`);
						return response.json();
					}
				})
			}, SubagentsView));
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "omp-sub-model-seat",
				order: 80,
				inject: (sessionId) => ({
					hooks: { ompTasks: storeFor(sessionId) },
					sessionId,
					directory: ctx.modelDirectories?.directoryFor?.(sessionId) ?? null,
					setView: (view) => storeFor(sessionId).set({ view }),
					load: async () => {
						const response = await fetch(`/api/tasks/view?session=${encodeURIComponent(sessionId)}`, { credentials: "same-origin" });
						if (!response.ok) throw new Error(`tasks view ${response.status}`);
						return response.json();
					},
					save: async (route) => {
						const params = new URLSearchParams({ session: sessionId });
						if (route === null) params.set("clear", "1");
						else {
							params.set("provider", route.provider);
							params.set("model", route.model);
						}
						const response = await fetch(`/api/tasks/sub-model?${params}`, { method: "POST", credentials: "same-origin" });
						if (!response.ok) throw new Error(`tasks sub-model ${response.status}`);
						return response.json();
					}
				})
			}, SubModelSeat));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.emptyLabel = emptyLabel;
		exports.linesFor = linesFor;
		exports.modelName = modelName;
		exports.seatCopy = seatCopy;
		exports.statusRows = statusRows;
		return module.exports;
	}
});
