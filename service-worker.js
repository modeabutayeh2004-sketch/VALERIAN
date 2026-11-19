/* VALERIAN V20.117 — single-document engine integration */
'use strict';
const CACHE_NAME = 'valerian-app-shell-v20-135-return-losses';
const APP_SHELL = ['./', './index.html', './engine-runtime.js?v=v5-return-losses-20261119', './manifest.webmanifest', './assets/valerian-icon.jpg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('valerian-app-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          cache.put('./index.html', response.clone()).catch(() => {});
          return response;
        }
      } catch (_) {}
      return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error();
    })());
    return;
  }

  // Cache application assets only; never cache Supabase/API data.
  if (url.pathname.startsWith(new URL('./', self.location).pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch (_) {
        return cached || Response.error();
      }
    })());
  }
});
