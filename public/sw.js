// Minimal service worker: makes the app installable (and the Android share target
// available) on browsers that still require one. It caches nothing and does not
// intercept requests, so the app always loads the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A new class notice: show it, and open the schedule when it is tapped.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "ParentDesk", { body: data.body || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url || "/" } }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const given = (event.notification.data && event.notification.data.url) || "/";
  // only pages of this app, whatever the message said
  let url = "/";
  try {
    const parsed = new URL(String(given), self.location.origin);
    if (parsed.origin === self.location.origin) url = parsed.href;
  } catch {
    url = "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
