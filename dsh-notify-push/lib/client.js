window.__ModuleLoader__.load({
	id: "dsh-notify-push",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region lib/client.js
		/**
		* dsh-notify-push — browser half.
		*
		* 1. Registers the service worker at /push/sw.js (scope /).
		* 2. Registers a /notify command (popupSelect on/off) that requests the
		*    Notification permission, subscribes to Web Push with the host VAPID key,
		*    and stores the subscription at /api/push/subscribe.
		* 3. Prepends a `user-questions/request` remote waterfall listener that shows
		*    an immediate local Notification while the page is alive; Web Push covers
		*    the background case. Never answers the waterfall — always delegates.
		*/
		const PUSH_SW_URL = "/push/sw.js";
		const SUBSCRIBE_URL = "/api/push/subscribe";
		const UNSUBSCRIBE_URL = "/api/push/unsubscribe";
		const VAPID_URL = "/api/push/vapid";
		const STATE_KEY = "dsh-notify-push:enabled";

		function questionSummary(request) {
			const questions = Array.isArray(request?.questions) ? request.questions : [];
			const first = questions[0] ?? {};
			const header = typeof first.header === "string" && first.header.length > 0 ? first.header : "選択肢";
			const questionText = typeof first.question === "string" ? first.question : "";
			const extra = questions.length > 1 ? `（他 ${questions.length - 1} 件）` : "";
			return {
				title: `DSH: ${header}${extra}`,
				body: questionText,
				options: questions[0]?.options ?? []
			};
		}

		/** Show a local notification; silently no-ops without permission or API. */
		function showLocalNotification(summary) {
			if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
			try {
				const notification = new Notification(summary.title, {
					body: summary.body,
					tag: "dsh-ask-user",
					renotify: true
				});
				notification.onclick = () => {
					window.focus();
					notification.close();
				};
			} catch (error) {
				console.warn("[notify-push] local notification failed", error);
			}
		}

		async function urlBase64ToUint8Array(base64String) {
			const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
			const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
			const raw = atob(base64);
			const output = new Uint8Array(raw.length);
			for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
			return output;
		}

		async function registration() {
			if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return void 0;
			try {
				return await navigator.serviceWorker.register(PUSH_SW_URL, { scope: "/" });
			} catch (error) {
				console.warn("[notify-push] service worker registration failed", error);
				return void 0;
			}
		}

		async function subscribePush() {
			const reg = await registration();
			if (reg === void 0 || !("pushManager" in reg)) throw new Error("Push API unavailable in this browser");
			const { publicKey } = await fetch(VAPID_URL).then((response) => {
				if (!response.ok) throw new Error(`vapid fetch failed: ${response.status}`);
				return response.json();
			});
			const existing = await reg.pushManager.getSubscription();
			const subscription = existing ?? await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: await urlBase64ToUint8Array(publicKey)
			});
			const response = await fetch(SUBSCRIBE_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					subscription: subscription.toJSON(),
					label: typeof navigator.userAgent === "string" ? navigator.userAgent : ""
				})
			});
			if (!response.ok) throw new Error(`subscribe failed: ${response.status}`);
			return subscription;
		}

		async function unsubscribePush() {
			const reg = await registration();
			const sub = reg === void 0 ? void 0 : await reg.pushManager.getSubscription();
			if (sub !== void 0) {
				try {
					await fetch(UNSUBSCRIBE_URL, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ endpoint: sub.endpoint })
					});
				} catch (error) {
					console.warn("[notify-push] unsubscribe POST failed", error);
				}
				await sub.unsubscribe();
			}
		}

		const inject = ["remote", "commandUi"];

		function apply(ctx) {

			/** Outermost listener: local notification + delegate to the real answerer. */
			ctx.remote.$on("user-questions/request", function(request, next) {
				try {
					showLocalNotification(questionSummary(request));
				} catch (error) {
					console.warn("[notify-push] listener failed", error);
				}
				return next();
			});

			/** Restore the saved toggle (re-subscribe when permission already granted). */
			ctx.effect(() => {
				if (typeof localStorage === "undefined") return;
				if (localStorage.getItem(STATE_KEY) !== "on") return;
				if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
				subscribePush().catch((error) => console.warn("[notify-push] re-subscribe failed", error));
				return () => {};
			}, "notify-push: startup re-subscribe");

			/** Ground truth: the durable toggle + actual permission, not in-memory state. */
			const statusLabel = () => {
				if (typeof Notification === "undefined") return "通知非対応のブラウザ";
				if (typeof localStorage === "undefined") return Notification.permission === "granted" ? "ON" : "OFF";
				if (Notification.permission === "denied") return "OFF (許可がブロック済み)";
				return localStorage.getItem(STATE_KEY) === "on" && Notification.permission === "granted" ? "ON" : "OFF";
			};

			ctx.effect(() => {
				if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
				const enforceState = () => {
					if (typeof localStorage === "undefined") return;
					const desired = localStorage.getItem(STATE_KEY);
					if (desired === "on" && Notification.permission === "granted") void subscribePush();
					else if (desired !== "on") void unsubscribePush();
				};
				navigator.serviceWorker.addEventListener("controllerchange", enforceState);
				return () => {
					navigator.serviceWorker.removeEventListener("controllerchange", enforceState);
				};
			}, "notify-push: sw lifecycle");

			ctx.inject(["commandUi"], (scope) => {
				const command = scope.get("commandUi");
				scope.effect(() => command.register({
					name: "notify",
					description: "質問時の通知 (Web Push) のON/OFF",
					available: () => typeof Notification !== "undefined" && "PushManager" in window,
					ui: {
						kind: "popupSelect",
						options: async () => [
							{ id: "on", label: `ON にする`, description: `現在: ${statusLabel()} / 通知を許可し、購読を登録する` },
							{ id: "off", label: `OFF にする`, description: `現在: ${statusLabel()} / 購読を解除し、通知を止める` }
						],
						onSelect: async (option) => {
							if (option.id === "on") {
								const permission = await Notification.requestPermission();
								if (permission !== "granted") throw new Error("通知の許可が得られませんでした (ブラウザ設定を確認)");
								await subscribePush();
								if (typeof localStorage !== "undefined") localStorage.setItem(STATE_KEY, "on");
							} else {
								await unsubscribePush();
								if (typeof localStorage !== "undefined") localStorage.setItem(STATE_KEY, "off");
							}
						}
					}
				}), "notify-push: /notify contribution");
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
