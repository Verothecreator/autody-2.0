const AUTODY_CACHE = "autody-shell-v1";
const AUTODY_SHELL = [
  "/",
  "/index",
  "/sign-in",
  "/sign-up",
  "/account",
  "/account-wallet",
  "/account-markets",
  "/account-orders",
  "/styles.css",
  "/Autody-Logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(AUTODY_CACHE)
      .then((cache) => cache.addAll(AUTODY_SHELL))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== AUTODY_CACHE).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(AUTODY_CACHE).then((cache) => cache.put(request, clone)).catch(() => null);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/index")))
  );
});
