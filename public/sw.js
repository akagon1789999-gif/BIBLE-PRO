// Minimal service worker: exists mainly to satisfy Chrome's PWA
// installability requirement (a controlling SW with a fetch handler).
// Caches the static app shell for faster reloads; anything dynamic
// (API calls, the WebSocket, uploaded/motion media) always goes to the
// network so nothing here can ever serve stale Scripture, verses,
// backgrounds, or transcripts.
const CACHE_NAME = "projector-bible-v2";
const APP_SHELL = [
  "/operator.html",
  "/operator.js",
  "/display.html",
  "/display.js",
  "/manifest-operator.json",
  "/manifest-display.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const NEVER_CACHE_PREFIXES = ["/api/", "/uploads/", "/motion-backgrounds/", "/ws"];

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || NEVER_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    return; // let the browser handle it normally — no offline fallback for dynamic/live data
  }
  // Network-first, not cache-first: always serve the freshest operator.js/
  // display.js when online (a stale cache-first strategy here previously
  // caused genuinely confusing bugs during development — edits wouldn't
  // show up until the cache was manually cleared). Only fall back to the
  // cached copy when the network request actually fails, i.e. really offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
