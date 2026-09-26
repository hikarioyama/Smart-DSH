window.__ModuleLoader__.load({ id: "dsh-btw", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let __deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
__deepseek_ai_dsh_client_ui_primitives = __toESM(__deepseek_ai_dsh_client_ui_primitives);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region node_modules/.pnpm/@deepseek-ai+dsh-brand@0.1.5-rc.2_@deepseek-ai+cordis@4.0.2/node_modules/@deepseek-ai/dsh-brand/lib/index.js
/**
* Duplicate-install-safe nominal primitive helpers.
*
* A brand makes structurally identical strings or numbers non-interchangeable
* at the type level: a `SessionId` cannot be passed where a `ToolCallId` is
* expected, and an event sequence cannot be passed as a log offset. Comparison,
* logging, and serialization retain the underlying primitive behavior.
*
* This package owns no concrete domain value and keeps no runtime identity or mutable
* state, so independently installed copies produce interchangeable values.
*
* @module @deepseek-ai/dsh-brand
*/
/**
* Apply a compile-time string brand without changing the value.
* @param value - string admitted by the domain that owns the target brand.
* @returns the same string with the requested compile-time brand.
*/
function brandString(value) {
	return value;
}

//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.5-rc.2_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._54d1a918d77e481567353c23a9e2039f/node_modules/@deepseek-ai/dsh-session/lib/types/types.js
/**
* Brand a string as a {@link SessionId}.
* @param id - the raw session id string.
* @returns the same string with the session-id brand.
*/
function SessionId(id) {
	return brandString(id);
}

//#endregion
//#region src/client/compat/layout.ts
/**
* The panel is laid out as a second DSH composer: it inherits the composer card's
* own maximum width instead of insetting away from the composer's resize handles.
* Only public `--dsh-*` tokens are referenced, so an upstream layout change
* degrades to the token defaults rather than breaking the panel.
*/
const dockStyle = {
	width: "100%",
	maxWidth: "var(--dsh-composer-card-max-width, 720px)",
	marginLeft: "auto",
	marginRight: "auto"
};

//#endregion
//#region src/client/input-source.ts
function createBtwClaim(controller, commandToken = "/btw") {
	return {
		token: `${commandToken} `,
		hint: "<your question>",
		submit: (args) => controller.ask(args, true)
	};
}
function enterClaim(controllerFor, sessionId, line) {
	const match = /^\s*(\/btw)(?=\s|$)/iu.exec(line);
	if (match?.[1] === void 0) return void 0;
	return { claim: createBtwClaim(controllerFor(sessionId), match[1]) };
}
function createBtwInputSource(controllerFor) {
	return {
		trigger: "/",
		name: "btw",
		order: -10,
		candidates(_session, request) {
			if (request.position !== "leading" || !"btw".startsWith(request.query.toLowerCase())) return Promise.resolve([]);
			return Promise.resolve([{
				name: "btw",
				description: "Ask a side question without interrupting the main agent",
				hint: "<your question>"
			}]);
		},
		onPick(pick) {
			return { claim: createBtwClaim(controllerFor(pick.session.sessionId)) };
		},
		matchSpace(session, token) {
			return /^\/btw$/iu.test(token) ? { claim: createBtwClaim(controllerFor(session.sessionId), token) } : void 0;
		},
		matchEnter(session, line) {
			return Promise.resolve(enterClaim(controllerFor, session.sessionId, line));
		}
	};
}

//#endregion
//#region src/client/compat/input.ts
function bindInput(input, controller) {
	let active = true, queued = false;
	const update = () => {
		if (queued || !active) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			if (!active) return;
			if (input.editor?.isComposing?.() === true) return;
			const state = input.state.getSnapshot();
			const match = state.phase === "plain" ? /^\s*(\/btw)(?=\s|$)/i.exec(state.draft) : null;
			if (!match || !/\s/.test(state.draft.slice(match[0].length, match[0].length + 1))) return;
			const end = /^\s*\/btw\s+/i.exec(state.draft)[0].length;
			if (state.draft.slice(end) !== "") return;
			if (state.occurrences.some((o) => o.offset < end)) return;
			input.beginCommand(createBtwClaim(controller, match[1]), {
				start: 0,
				end,
				draftRev: state.draftRev
			});
		});
	};
	const unsubscribe = input.state.subscribe(update);
	update();
	return () => {
		active = false;
		unsubscribe();
	};
}

//#endregion
//#region src/shared/protocol.ts
const BTW_ASK_ENDPOINT = "dsh-btw/ask";
function readTurn(value) {
	if (!value || typeof value !== "object") return void 0;
	const t = value;
	if (typeof t.id !== "string" || typeof t.question !== "string" || typeof t.at !== "number" || !Number.isFinite(t.at) || !(t.anchorSeq === null || typeof t.anchorSeq === "number" && Number.isSafeInteger(t.anchorSeq) && t.anchorSeq >= 0)) return void 0;
	if (t.answer !== void 0 && typeof t.answer !== "string") return void 0;
	if (t.error !== void 0 && typeof t.error !== "string") return void 0;
	return t;
}
const BTW_FORK_ENDPOINT = "dsh-btw/fork";

//#endregion
//#region src/client/controller.ts
/**
* Pure state machine; no DSH, DOM or React dependency.
*
* The panel only shows the thread the user is working on now: nothing is restored
* from the audit store, and a new `/btw` from the main composer starts a fresh
* view while panel follow-ups append to it. Every exchange is still recorded in
* the audit store, and fork reads that store through the host.
*/
var BtwController = class {
	value = {
		open: false,
		busy: false,
		turns: [],
		question: "",
		error: null
	};
	listeners = /* @__PURE__ */ new Set();
	state = {
		getSnapshot: () => this.value,
		subscribe: (listener) => {
			this.listeners.add(listener);
			return () => {
				this.listeners.delete(listener);
			};
		}
	};
	active;
	disposed = false;
	constructor(connection, sessionId, timeoutMs = 125e3) {
		this.connection = connection;
		this.sessionId = sessionId;
		this.timeoutMs = timeoutMs;
	}
	set(patch) {
		this.value = {
			...this.value,
			...patch
		};
		for (const listener of this.listeners) listener();
	}
	open() {
		this.set({ open: true });
	}
	ask(raw, fresh = false) {
		const question$1 = raw.trim();
		if (!question$1) return Promise.resolve({
			kind: "error",
			text: "Type a question after /btw"
		});
		if (question$1.length > 32e3) return Promise.resolve({
			kind: "error",
			text: "Question exceeds 32000 characters"
		});
		if (this.value.busy) return Promise.resolve({
			kind: "error",
			text: "Wait for the current BTW answer or cancel it first"
		});
		const control = new AbortController();
		this.active = control;
		this.set({
			open: true,
			busy: true,
			question: question$1,
			error: null,
			...fresh ? { turns: [] } : {}
		});
		this.run(question$1, control);
		return Promise.resolve({ kind: "success" });
	}
	async run(question$1, control) {
		try {
			const requestId = crypto.randomUUID();
			const result = await this.connection.rpc.call("/api", BTW_ASK_ENDPOINT, {
				sessionId: this.sessionId,
				question: question$1,
				requestId
			}, AbortSignal.any([control.signal, AbortSignal.timeout(this.timeoutMs)]));
			if (this.disposed || control.signal.aborted) return;
			if (!result.ok) throw Error(result.error.message);
			const turn = readTurn(result.value?.turn);
			if (!turn || turn.id !== requestId) throw Error("Invalid BTW response");
			this.set({
				turns: [...this.value.turns.filter((t) => t.id !== turn.id), turn],
				question: ""
			});
		} catch (error) {
			if (!this.disposed) this.set({ error: control.signal.aborted ? "Cancelled; audit record retained" : error instanceof Error ? error.message : "BTW failed" });
		} finally {
			if (this.active === control) {
				this.active = void 0;
				if (!this.disposed) this.set({ busy: false });
			}
		}
	}
	async fork(turnId) {
		const result = await this.connection.rpc.call("/api", BTW_FORK_ENDPOINT, {
			sessionId: this.sessionId,
			turnId
		}, AbortSignal.timeout(3e4));
		if (!result.ok) throw Error(result.error.message);
		const child = result.value?.childSessionId;
		if (typeof child !== "string") throw Error("Invalid fork result");
		return child;
	}
	cancel() {
		this.active?.abort();
	}
	dismiss() {
		this.set({ open: false });
	}
	dispose() {
		this.disposed = true;
		this.active?.abort();
		this.set({
			open: false,
			busy: false
		});
		this.listeners.clear();
	}
};

//#endregion
//#region src/client/ui/panel-bounds.ts
/** Bookmarks / favorites bar kept clear of the BTW resize handle on phones. */
const BOOKMARK_BAR_PX = 48;
/** Desktop only needs the handle inside the viewport, not under a bookmarks bar. */
const DESKTOP_TOP_GAP_PX = 8;
const MIN_TRANSCRIPT_PX = 100;
function isPhoneViewport(coarsePointer, width) {
	return coarsePointer || width < 768;
}
/**
* Visual-viewport y the BTW panel top must stay at or below.
* `getBoundingClientRect().top` is already visual-viewport-relative, so this
* is a gap under the browser chrome. On a phone that gap covers a bookmarks
* or favorites bar that overlays the visual viewport.
*/
function btwTopLimit(phone, safeAreaTop$1 = 0) {
	return Math.max(0, safeAreaTop$1, phone ? BOOKMARK_BAR_PX : DESKTOP_TOP_GAP_PX);
}
/**
* Transcript height that puts the panel top on `limit`.
* Positive slack means the handle can still move up; negative slack means it
* is already under the bookmarks bar and must shrink.
*/
function transcriptHeightForTop(currentHeight, panelTop, limit, min = MIN_TRANSCRIPT_PX) {
	return Math.max(min, Math.round(currentHeight + (panelTop - limit)));
}
function clampHeight(height, viewport, measuredMax) {
	const byRatio = Math.max(MIN_TRANSCRIPT_PX, viewport * .7);
	const max = measuredMax === void 0 ? byRatio : Math.min(byRatio, Math.max(MIN_TRANSCRIPT_PX, measuredMax));
	return Math.max(MIN_TRANSCRIPT_PX, Math.min(max, height));
}

//#endregion
//#region src/client/ui/panel.tsx
/** Build one style object that may also carry CSS custom properties. */
const css = (value) => value;
/**
* Surface styling copied from the DSH composer card (same tokens, radius and
* maximum width) so the panel reads as a second DSH input rather than a custom
* widget. Only public `--dsw-*` / `--dsh-*` tokens are used; no hashed upstream
* CSS-module class is referenced.
*/
const card = css({
	boxSizing: "border-box",
	flex: "none",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	background: "var(--dsw-specific-input-major, Canvas)",
	boxShadow: "var(--dsw-elevation-soft, none)",
	borderRadius: 22,
	color: "var(--dsw-alias-label-primary, CanvasText)",
	fontSize: "var(--dsh-content-font-size, 14px)",
	lineHeight: "calc(24px + var(--dsh-content-font-delta, 0px))",
	"--dsw-elevation-stroke-color": "var(--dsw-alias-border-l2)",
	"--dsh-scrollbar-thumb": "var(--dsw-alias-scrollbar-bg-l2)",
	"--dsh-scrollbar-thumb-hover": "var(--dsw-alias-scrollbar-hover-l2)"
});
const caption = css({
	color: "var(--dsw-alias-label-secondary, GrayText)",
	fontSize: 12,
	lineHeight: "18px",
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap"
});
const question = css({
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
	fontWeight: 600
});
const answer = css({
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
	margin: "6px 0 0"
});
const storageKey = "smart-dsh.btw.height.v1";
function initialHeight() {
	try {
		const n = Number(localStorage.getItem(storageKey));
		return Number.isFinite(n) && n >= 100 ? n : 300;
	} catch {
		return 300;
	}
}
function phoneLayout() {
	if (typeof window === "undefined") return false;
	return isPhoneViewport(window.matchMedia("(pointer: coarse)").matches, window.innerWidth);
}
function safeAreaTop() {
	if (typeof document === "undefined") return 0;
	const probe = document.createElement("div");
	probe.style.paddingTop = "env(safe-area-inset-top)";
	document.body.appendChild(probe);
	const value = Number.parseFloat(getComputedStyle(probe).paddingTop);
	probe.remove();
	return Number.isFinite(value) ? value : 0;
}
function visibleHeight() {
	return window.visualViewport?.height ?? window.innerHeight;
}
/** Local layout only: no hashed upstream CSS selectors or document listeners. */
function BtwOverlay({ controller, openChild, dockStyle: dockStyle$1 }) {
	const state = (0, react.useSyncExternalStore)(controller.state.subscribe, controller.state.getSnapshot);
	const [height, setHeight] = (0, react.useState)(initialHeight);
	const [phone, setPhone] = (0, react.useState)(phoneLayout);
	const transcript = (0, react.useRef)(null);
	const root = (0, react.useRef)(null);
	const followTail = (0, react.useRef)(true);
	const limitTop = () => btwTopLimit(phoneLayout(), safeAreaTop());
	const fitCeiling = () => {
		const el = root.current;
		if (!el) return;
		const next = transcriptHeightForTop(el.querySelector("[data-btw-transcript]")?.offsetHeight || height, el.getBoundingClientRect().top, limitTop());
		setHeight((current) => current - next > 1 ? next : current);
	};
	(0, react.useEffect)(() => {
		const el = transcript.current;
		if (el && followTail.current) el.scrollTop = el.scrollHeight;
	}, [
		state.turns,
		state.busy,
		state.open
	]);
	(0, react.useEffect)(() => {
		if (!state.open) return;
		const refit = () => {
			setPhone(phoneLayout());
			fitCeiling();
		};
		refit();
		const viewport = window.visualViewport;
		viewport?.addEventListener("resize", refit);
		viewport?.addEventListener("scroll", refit);
		window.addEventListener("resize", refit);
		return () => {
			viewport?.removeEventListener("resize", refit);
			viewport?.removeEventListener("scroll", refit);
			window.removeEventListener("resize", refit);
		};
	}, [state.open, height]);
	const [draft, setDraft] = (0, react.useState)("");
	const [error, setError] = (0, react.useState)("");
	const [forking, setForking] = (0, react.useState)(false);
	const [drag, setDrag] = (0, react.useState)(null);
	const resize = (value, measuredMax) => {
		const next = clampHeight(value, visibleHeight(), measuredMax);
		setHeight(next);
		try {
			localStorage.setItem(storageKey, String(next));
		} catch {}
	};
	const move = (e) => {
		if (drag) resize(drag.height + drag.y - e.clientY, drag.max);
	};
	if (!state.open) return null;
	/** One icon button in the DSH toolbar visual family. */
	const iconButton = (label, icon, onClick, disabled = false) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Tooltip, {
		label,
		side: "bottom",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Button, {
			variant: "ghost",
			size: "sm",
			icon,
			"aria-label": label,
			disabled,
			onClick,
			style: {
				padding: 0,
				width: 28
			}
		})
	});
	const topLimit = phone ? `max(env(safe-area-inset-top, 0px), ${BOOKMARK_BAR_PX}px)` : "8px";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		ref: root,
		"data-smart-btw": true,
		style: {
			...card,
			...dockStyle$1,
			maxHeight: `calc(100svh - ${topLimit} - 160px)`
		},
		role: "dialog",
		"aria-label": "BTW side thread",
		"aria-modal": "false",
		onKeyDown: (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				controller.dismiss();
			}
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				role: "separator",
				"aria-label": "Resize BTW",
				"aria-orientation": "horizontal",
				tabIndex: 0,
				style: {
					height: 14,
					flex: "none",
					cursor: "ns-resize",
					touchAction: "none",
					display: "flex",
					alignItems: "center",
					justifyContent: "center"
				},
				onPointerDown: (e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					const panelTop = root.current?.getBoundingClientRect().top ?? limitTop();
					setDrag({
						y: e.clientY,
						height,
						max: transcriptHeightForTop(height, panelTop, limitTop())
					});
				},
				onPointerMove: move,
				onPointerUp: () => setDrag(null),
				onPointerCancel: () => setDrag(null),
				onLostPointerCapture: () => setDrag(null),
				onKeyDown: (e) => {
					if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
					e.preventDefault();
					const panelTop = root.current?.getBoundingClientRect().top ?? limitTop();
					resize(height + (e.key === "ArrowUp" ? 30 : -30), transcriptHeightForTop(height, panelTop, limitTop()));
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": true,
					style: {
						width: 36,
						height: 4,
						borderRadius: 2,
						background: "var(--dsw-alias-border-l2, #8884)"
					}
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				style: {
					display: "flex",
					gap: 8,
					alignItems: "center",
					padding: "0 12px 4px",
					flex: "none"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						style: { flex: "none" },
						children: "/btw"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: caption,
						children: "Main task continues · audit saved separately"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
					state.busy && iconButton("Cancel BTW", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconStopFill16, {}), () => controller.cancel()),
					iconButton("Close", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {}), () => controller.dismiss())
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-btw-transcript": true,
				ref: transcript,
				onScroll: (e) => {
					const el = e.currentTarget;
					followTail.current = el.scrollHeight - el.clientHeight - el.scrollTop < 64;
				},
				style: {
					overflow: "auto",
					minHeight: 0,
					height,
					maxHeight: phone ? "100%" : "70dvh",
					overscrollBehavior: "contain",
					padding: "4px 16px 8px"
				},
				children: [state.turns.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
					style: {
						paddingBottom: 12,
						marginBottom: 12,
						borderBottom: "1px solid var(--dsw-alias-border-l1, #8883)"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6,
							alignItems: "flex-start"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								...question,
								flex: 1,
								minWidth: 0
							},
							children: t.question
						}), t.answer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							side: "bottom",
							label: t.anchorSeq === null ? "Fork needs a completed parent turn" : "Branch into a new conversation",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}),
								"aria-label": "Branch into a new conversation",
								"aria-disabled": forking || state.busy || t.anchorSeq === null || void 0,
								disabled: forking || state.busy || t.anchorSeq === null,
								style: {
									flex: "none",
									padding: 0,
									width: 28
								},
								onClick: () => {
									setForking(true);
									setError("");
									controller.fork(t.id).then(async (id) => {
										if (openChild) await openChild(id);
										else setError(`Fork created: ${id}`);
									}).catch((e) => setError(String(e))).finally(() => setForking(false));
								}
							})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: answer,
						children: t.answer ?? t.error ?? "No completed result recorded (pending or interrupted)"
					})]
				}, t.id)), state.busy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "status",
					style: {
						...caption,
						whiteSpace: "pre-wrap"
					},
					children: [
						state.question,
						"\n",
						"Answering independently…"
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: {
					display: "flex",
					gap: 8,
					alignItems: "flex-end",
					padding: "8px 12px 12px",
					flex: "none"
				},
				onSubmit: (e) => {
					e.preventDefault();
					controller.ask(draft).then((r) => {
						if (r.kind === "success") setDraft("");
						else setError(r.text);
					});
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					"aria-label": "BTW follow-up",
					value: draft,
					onChange: (e) => setDraft(e.target.value),
					rows: 1,
					placeholder: "Ask a side question",
					style: {
						flex: 1,
						minWidth: 0,
						maxHeight: 160,
						resize: "none",
						font: "inherit",
						lineHeight: "inherit",
						color: "inherit",
						background: "transparent",
						border: 0,
						outline: "none",
						padding: "7px 0"
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: "Ask BTW",
					side: "bottom",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						size: "md",
						type: "submit",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconSendOutline16, {}),
						"aria-label": "Ask BTW",
						disabled: state.busy || !draft.trim(),
						style: {
							flex: "none",
							width: 36,
							padding: 0,
							borderRadius: 18
						}
					})
				})]
			}),
			(error || state.error) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				role: "alert",
				style: {
					padding: "0 16px 12px",
					color: "var(--dsw-alias-label-warning, inherit)",
					overflowWrap: "anywhere"
				},
				children: error || state.error
			})
		]
	});
}

//#endregion
//#region src/client/index.tsx
const name = "btw-client";
const inject = [
	"connection",
	"inputTriggers",
	"sessions",
	"slots",
	"conversation"
];
function apply(ctx) {
	const connection = ctx.get("connection");
	const inputTriggers = ctx.get("inputTriggers");
	const sessions = ctx.get("sessions");
	if (connection === void 0 || inputTriggers === void 0 || sessions === void 0) throw new Error("dsh-btw/client requires connection, inputTriggers, and sessions");
	const conversation = ctx.conversation;
	const controllers = /* @__PURE__ */ new Map();
	const boundScopes = /* @__PURE__ */ new Set();
	const controllerFor = (sessionId) => {
		let controller = controllers.get(sessionId);
		if (controller === void 0) {
			controller = new BtwController(connection, sessionId);
			controllers.set(sessionId, controller);
		}
		return controller;
	};
	ctx.effect(() => inputTriggers.registerSource(createBtwInputSource(controllerFor)), "dsh-btw: slash source");
	ctx.effect(() => () => {
		for (const controller of controllers.values()) controller.dispose();
		controllers.clear();
		boundScopes.clear();
	}, "dsh-btw: controller teardown");
	ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
		name: "conversation.input.dock",
		id: "btw-panel",
		order: 2,
		inject: (scopeId) => {
			const sessionId = SessionId(scopeId);
			const actx = sessions.scope(sessionId);
			if (actx === void 0) throw new Error(`dsh-btw: session "${String(sessionId)}" resolved no client scope`);
			const controller = controllerFor(sessionId);
			if (!boundScopes.has(sessionId)) {
				boundScopes.add(sessionId);
				actx.effect(() => bindInput(conversation.input.for(actx), controller));
				actx.effect(() => () => {
					boundScopes.delete(sessionId);
					if (controllers.get(sessionId) === controller) controllers.delete(sessionId);
					controller.dispose();
				}, "dsh-btw: session controller");
			}
			return {
				controller,
				dockStyle,
				openChild: async (id) => {
					await sessions.refresh();
					sessions.open(SessionId(id));
				}
			};
		}
	}, BtwOverlay));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map