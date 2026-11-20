/* PDF READER PRO — Service Worker v2.0.2
   Pembaruan cache aplikasi tanpa menghapus database PDF pengguna.
*/
const APP_VERSION = "2.0.2";
const CACHE = "pdf-reader-pro-shell-" + APP_VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/main.css",
  "./css/reader.css",
  "./js/database.js",
  "./js/app.js",
  "./js/reader.js",
  "./js/advanced.js",
  "./js/update-manager.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("pdf-reader-pro-shell-") && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
