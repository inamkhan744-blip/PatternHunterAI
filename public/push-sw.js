/* PatternHunter AI — Web Push handlers.
 *
 * Imported into the generated Workbox service worker via vite-plugin-pwa
 * (`workbox.importScripts`). This makes the app able to receive real push
 * messages and focus/open the right screen when a notification is tapped.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "PatternHunter AI", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "PatternHunter AI";
  const options = {
    body: payload.body || "You have a new trading alert.",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: payload.tag || "patternhunter-alert",
    data: { url: payload.url || "/" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(targetUrl);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })()
  );
});
