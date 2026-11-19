/* VALERIAN V20 — canonical offline shell with network-first updates */
'use strict';

// Bump this value whenever the HTML, application engine, or offline strategy changes.
const CACHE_NAME = 'valerian-app-shell-v20-20261119-cleanup11';
const APP_SHELL = [
  './index.html',
  './engine-runtime.js?v=v20-20261119-cleanup11',
  './manifest.webmanifest',
  './assets/valerian-icon.jpg'
];

const INDEX_URL = new URL('./index.html', self.registration.scope).href;

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

  // Let the browser's update mechanism fetch the worker itself.
  if (url.pathname.endsWith('/service-worker.js')) return;

  const appRoot = new URL('./', self.registration.scope).pathname;
  if (!url.pathname.startsWith(appRoot)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const isNavigation = request.mode === 'navigate';
    try {
      // Network-first keeps online users on the deployed V20 release.
      const response = await fetch(request, { cache: 'no-store' });
      if (response && response.ok) {
        // All document navigations share ONE canonical cached document.
        // Never keep a separate stale cache entry for "./" and "index.html".
        cache.put(isNavigation ? INDEX_URL : request, response.clone()).catch(() => {});
        return response;
      }
    } catch (error) {
      // Continue with the canonical offline application shell.
    }

    if (isNavigation) {
      return (await cache.match(INDEX_URL)) || Response.error();
    }
    return (await cache.match(request)) || Response.error();
  })());
});
