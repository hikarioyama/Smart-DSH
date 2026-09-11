window.__ModuleLoader__.load({
	id: "dsh-esc-stop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region dsh-esc-stop — browser half
		/**
		 * dsh-esc-stop — browser half.
		 *
		 * 1. Installs one document-level `keydown` listener that cancels the running
		 *    turn when Escape is pressed and no nearer surface claims the key.
		 * 2. Registers one General-settings row that flips the durable
		 *    `esc-stop.enabled` host setting, so the gesture is switchable without
		 *    editing files or restarting DSH.
		 *
		 * The listener runs in the bubble phase. The composer keymap sits on the
		 * editor root (the event target), so a menu, popupSelect, or dialog that
		 * consumes Escape has already called `preventDefault()` by the time the
		 * event reaches the document, and {@link decideEscapeStop} then refuses.
		 */
		const jsxRuntime = require("react/jsx-runtime");
		const clientStore = require("@deepseek-ai/dsh-client-store");

		/** Settings slot this bundle contributes its toggle row to. */
		const SLOT = "settings.general.item";
		/** Settings namespace owned by the host half of this bundle. */
		const NAMESPACE = "esc-stop";

		//#region escape decision and listener
		// Self-contained: the browser regression script extracts exactly this
		// region from the shipped file, so nothing here may reach outside it.
		/** Field inside the namespace: whether Escape stops a running turn. */
		const FIELD = "enabled";
		/** Value used while the host section is loading, unavailable, or unset. */
		const DEFAULT_ENABLED = true;
		/** Native text fields own their own Escape handling (queue edit, dialogs). */
		const NATIVE_EDITOR_TAGS = ["INPUT", "TEXTAREA", "SELECT"];
		/** A modal surface owns Escape while it is open (the settings panel). */
		const MODAL_SELECTOR = '[aria-modal="true"]';
		/** An open list surface owns Escape too: command menu, popupSelect, pickers. */
		const OVERLAY_SELECTOR = '[role="listbox"],[role="menu"]';

		/** One refusal reason, so callers and tests can name why nothing happened. */
		const refuse = (reason) => ({ stop: false, reason });

		/**
		 * Decide whether one Escape keydown should stop the running turn.
		 *
		 * Pure: every ambient fact arrives through `env`, so the guard order is
		 * testable without a browser. Cheapest and most specific reasons first.
		 * @param event - the keyboard event being judged.
		 * @param env - `enabled` (durable toggle), `modalOpen`, `overlayOpen`,
		 *   `nativeEditorFocused`, and `current` (the viewed session resolution,
		 *   or undefined).
		 * @returns `{ stop: true, session }` or `{ stop: false, reason }`.
		 */
		function decideEscapeStop(event, env) {
			if (event === null || event === void 0) return refuse("no-event");
			if (event.key !== "Escape") return refuse("other-key");
			if (event.repeat === true) return refuse("key-repeat");
			if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return refuse("modifier-held");
			if (event.isComposing === true) return refuse("composing");
			if (event.defaultPrevented === true) return refuse("already-consumed");
			if (env.nativeEditorFocused === true) return refuse("native-editor-focused");
			if (env.modalOpen === true) return refuse("modal-open");
			if (env.overlayOpen === true) return refuse("overlay-open");
			if (env.enabled !== true) return refuse("disabled");

			const current = env.current;
			if (current === void 0 || current === null) return refuse("no-current-session");
			const session = current.session;
			if (session === void 0 || session === null) return refuse("no-session-face");
			const snapshot = typeof session.getSnapshot === "function" ? session.getSnapshot() : void 0;
			if (snapshot === void 0 || snapshot === null) return refuse("no-session-snapshot");
			if (snapshot.removed === true) return refuse("session-removed");
			if (snapshot.subagent !== null && snapshot.subagent !== void 0) return refuse("subagent-view");
			if (snapshot.running !== true) return refuse("not-running");
			return { stop: true, reason: "running", session };
		}

		/** Read the durable toggle, defaulting on until the host section lands. */
		function readEnabled(scope) {
			const snapshot = scope.getSnapshot();
			const value = snapshot === void 0 || snapshot === null ? void 0 : snapshot.value;
			if (value === void 0 || value === null) return DEFAULT_ENABLED;
			return value[FIELD] !== false;
		}

		/** Resolve the session the user is currently looking at, or undefined. */
		function currentSessionOf(ctx) {
			const sessions = ctx.get("sessions");
			if (sessions === void 0) return void 0;
			const list = sessions.list.getSnapshot();
			if (list === void 0 || list === null) return void 0;
			const id = list.current;
			if (id === void 0 || id === null) return void 0;
			const binding = sessions.binding(id);
			return binding === void 0 || binding === null ? void 0 : binding;
		}

		/** Ambient facts one keydown reads; the DOM parts stay behind `document`. */
		function readEnvironment(ctx, isEnabled, event, doc) {
			const target = event.target;
			const tag = target !== null && typeof target === "object" ? target.tagName : void 0;
			const nativeEditorFocused = typeof tag === "string" && NATIVE_EDITOR_TAGS.includes(tag.toUpperCase());
			const modalOpen = typeof doc.querySelector === "function" && doc.querySelector(MODAL_SELECTOR) !== null;
			const overlayOpen = typeof doc.querySelector === "function" && doc.querySelector(OVERLAY_SELECTOR) !== null;
			let current;
			try {
				current = currentSessionOf(ctx);
			} catch (error) {
				console.warn("[esc-stop] session lookup failed", error);
				current = void 0;
			}
			return { enabled: isEnabled(), modalOpen, overlayOpen, nativeEditorFocused, current };
		}

		/**
		 * Cancel the running turn exactly like the composer's own stop button: the
		 * session-scoped conversation service owns the failure presentation, and the
		 * session face is the fallback when that service is unavailable.
		 * @param ctx - the browser plugin context.
		 * @param decision - the accepted decision carrying the session face.
		 * @returns the cancel settlement, when the resolved path returns one.
		 */
		function cancelTurn(ctx, decision) {
			const id = decision.session === void 0 ? void 0 : decision.session.sessionId;
			if (id !== void 0 && id !== null) {
				const sessions = ctx.get("sessions");
				const scoped = sessions === void 0 ? void 0 : sessions.scope(id);
				const conversation = scoped === void 0 ? void 0 : scoped.get("conversation");
				if (conversation !== void 0 && typeof conversation.cancel === "function") return conversation.cancel();
			}
			return decision.session.cancel();
		}

		/**
		 * Install the Escape listener; returns its disposer.
		 *
		 * Capture phase, one deferred judgement. Capture runs before the composer
		 * keymap on the editor root, so the decision is deferred by one microtask:
		 * by then a nearer handler has either consumed the key
		 * (`defaultPrevented`) or left the overlay it closes still committed.
		 * Both are readable exactly once, and neither is readable inside capture.
		 */
		function installEscapeStop(ctx, isEnabled, doc) {
			const onKeyDown = (event) => {
				queueMicrotask(() => {
					let decision;
					try {
						decision = decideEscapeStop(event, readEnvironment(ctx, isEnabled, event, doc));
					} catch (error) {
						console.warn("[esc-stop] decision failed", error);
						return;
					}
					if (!decision.stop) return;
					try {
						const pending = cancelTurn(ctx, decision);
						if (pending !== void 0 && pending !== null && typeof pending.catch === "function") pending.catch((error) => console.warn("[esc-stop] cancel failed", error));
					} catch (error) {
						console.warn("[esc-stop] cancel failed", error);
					}
				});
			};
			doc.addEventListener("keydown", onKeyDown, true);
			return () => doc.removeEventListener("keydown", onKeyDown, true);
		}
		//#endregion

		/** The switch surface: DSH tokens only, so both themes read correctly. */
		function switchStyle(enabled, disabled) {
			return {
				boxSizing: "border-box",
				minWidth: "64px",
				padding: "5px 14px",
				border: "0.5px solid var(--dsw-alias-border-l4)",
				borderRadius: "20px",
				background: enabled ? "var(--dsw-alias-bg-module-platform)" : "transparent",
				color: "var(--dsw-alias-label-primary)",
				font: "inherit",
				fontSize: "13px",
				lineHeight: "20px",
				cursor: disabled ? "default" : "pointer",
				opacity: disabled ? "0.5" : "1"
			};
		}

		/**
		 * One General-settings row: title, description, and the ON/OFF switch.
		 * @param props - the store hook plus the write action from this bundle's inject.
		 * @returns the row element tree.
		 */
		function EscStopRow(props) {
			const useStore = props.useEscStop;
			const enabled = useStore((state) => state.enabled);
			const writable = useStore((state) => state.writable);
			return jsxRuntime.jsxs("div", {
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "16px",
					padding: "16px 0",
					borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
				},
				children: [jsxRuntime.jsxs("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: "2px",
						minWidth: "0"
					},
					children: [jsxRuntime.jsx("div", {
						style: {
							color: "var(--dsw-alias-label-primary)",
							fontSize: "14px",
							lineHeight: "22px"
						},
						children: "Esc で推論を停止"
					}), jsxRuntime.jsx("div", {
						style: {
							color: "var(--dsw-alias-label-tertiary)",
							fontSize: "12px",
							lineHeight: "18px"
						},
						children: "推論中に Esc を押すと、実行中のターンを停止します（メニュー・入力欄・設定パネル表示中は無効）"
					})]
				}), jsxRuntime.jsx("button", {
					type: "button",
					role: "switch",
					"aria-checked": enabled,
					"aria-label": "Esc で推論を停止",
					disabled: !writable,
					onClick: () => props.setEnabled(!enabled),
					style: switchStyle(enabled, !writable),
					children: enabled ? "ON" : "OFF"
				})]
			});
		}

		/**
		 * Required services: `sessions` resolves the viewed session, `settingsScope`
		 * carries the durable toggle, `slots` seats the settings row.
		 */
		const inject = ["sessions", "slots", "settingsScope"];

		/**
		 * Client plugin body.
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
			const isEnabled = () => readEnabled(scope);

			const store = clientStore.createSnapshotStore({
				enabled: DEFAULT_ENABLED,
				writable: false
			});
			const adopt = () => {
				const snapshot = scope.getSnapshot();
				store.set({
					enabled: readEnabled(scope),
					writable: snapshot !== void 0 && snapshot !== null && snapshot.writable === true
				});
			};
			ctx.effect(() => scope.subscribe(adopt), "esc-stop: settings subscription");
			adopt();

			ctx.effect(() => {
				if (typeof document === "undefined") return;
				return installEscapeStop(ctx, isEnabled, document);
			}, "esc-stop: escape listener");

			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: "esc-stop",
				order: 12,
				inject: () => ({
					hooks: { escStop: store },
					setEnabled: (value) => {
						scope.set(FIELD, value === true).catch((error) => console.warn("[esc-stop] settings write failed", error));
					}
				})
			}, EscStopRow));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.decideEscapeStop = decideEscapeStop;
		return module.exports;
	}
});
