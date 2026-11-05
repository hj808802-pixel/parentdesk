// Minimal service worker: makes the app installable (and the Android share target
// available) on browsers that still require one. It caches nothing and does not
// intercept requests, so the app always loads the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
