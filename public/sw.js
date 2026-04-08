// MaxiMail Service Worker
// Currently handles: install, activate, and fetch pass-through
// Future: push event handler for background notifications
// TODO: Add MaxiMail branded icons at public/icon-192.png and public/icon-512.png

const CACHE_NAME = "maximail-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

void CACHE_NAME;
