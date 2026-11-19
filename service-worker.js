/* VALERIAN V20 — versioned, network-first application shell */
'use strict';

// Change this value whenever the HTML or application engine changes.
const CACHE_NAME = 'valerian-app-shell-v20-20261119-cleanup5';
const APP_SHELL = [
  './',
  './index.html',
  './engine-runtime.js?v=v20-20261119-cleanup5',
  './manifest.webmanifest',
  './assets/valerian-icon.jpg'
];

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
    await Promise.all(
      keys.filter(key => key.startsWith('valerian-app-shell-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
    );
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

  // The worker script itself must always be fetched by the browser update mechanism.
  if (url.pathname.endsWith('/service-worker.js')) return;

  const appRoot = new URL('./', self.location).pathname;
  if (!url.pathname.startsWith(appRoot)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Always prefer the currently deployed HTML/JS over an older cached copy.
      const response = await fetch(request, { cache: 'no-store' });
      if (response && response.ok) {
        const cacheKey = request.mode === 'navigate' ? './index.html' : request;
        cache.put(cacheKey, response.clone()).catch(() => {});
        return response;
      }
    } catch (error) {
      // Offline fallback below.
    }

    return (await cache.match(request)) ||
           (request.mode === 'navigate' ? await cache.match('./index.html') : null) ||
           Response.error();
  })());
});
