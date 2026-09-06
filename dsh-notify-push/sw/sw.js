/* dsh-notify-push service worker — Web Push → notification, click → focus app. */

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
	let title = "DSH: 選択肢";
	let body = "エージェントが選択肢を提示しています";
	let url = "/";
	try {
		if (event.data !== null) {
			const data = event.data.json();
			if (typeof data.title === "string") title = data.title;
			if (typeof data.body === "string" && data.body.length > 0) body = data.body;
			if (typeof data.url === "string") url = data.url;
		}
	} catch (error) {
		// Non-JSON payload: keep defaults.
	}
	const options = {
		body,
		tag: "dsh-ask-user",
		renotify: true,
		requireInteraction: true,
		data: { url },
		actions: [{ action: "open", title: "開く" }]
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const target = event.notification.data?.url ?? "/";
	event.waitUntil((async () => {
		const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
		for (const client of clientList) {
			if ("focus" in client) {
				await client.focus();
				return;
			}
		}
		await self.clients.openWindow(target);
	})());
});
