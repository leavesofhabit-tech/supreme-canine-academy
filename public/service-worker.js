const CACHE = "sca-backend-review-0.2.6-r2";
const SHELL = ["/", "/index.html", "/config.js", "/app.bundle.js", "/src/styles.css", "/manifest.webmanifest", "/icons/academy-canine-2026.png", "/data/knowledge.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith("sca-review-") || key.startsWith("sca-backend-review-")) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Cache the public shell only. Build identity and future API/account routes
  // must keep their ordinary network behavior and must never enter this cache.
  if (url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    let cache = null;
    try {
      cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
    } catch { /* A blocked cache must not stop a usable network response. */ }
    try {
      const response = await fetch(request);
      if (cache && response.ok && response.type === "basic") {
        try { await cache.put(request, response.clone()); } catch { /* Storage can be full. */ }
      }
      return response;
    } catch {
      if (request.mode === "navigate" && cache) {
        try { const fallback = await cache.match("/index.html"); if (fallback) return fallback; } catch { /* Use the explicit offline response below. */ }
      }
      return new Response("Offline resource unavailable", { status: 503 });
    }
  })());
});
