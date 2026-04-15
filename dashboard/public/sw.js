/*
 * Akela service worker
 *
 * Responsibilities:
 *  1. Cache the app shell so the dashboard opens offline (even if it can't
 *     fetch live data, the UI loads and shows a "connection lost" state).
 *  2. Handle Web Push notifications from the backend.
 *  3. Focus/open the dashboard when a notification is clicked.
 *
 * Scope: /pack/ (set when main.tsx registers this worker).
 *
 * Bump CACHE_VERSION when changing the caching strategy to force clients
 * to refetch the shell. Hashed asset filenames from Vite are cached
 * opportunistically in the runtime cache and don't need version bumps.
 */

const CACHE_VERSION = 'akela-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// App shell — minimum needed to boot the SPA offline.
const SHELL_URLS = [
  '/pack/',
  '/pack/index.html',
  '/pack/manifest.json',
  '/pack/app-icon.svg',
  '/pack/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GETs go through the cache. POST/PUT/DELETE pass through untouched.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API calls: network-first, no caching. Akela data is live and we don't want
  // to serve stale agents/messages/tasks from the worker cache.
  if (url.pathname.startsWith('/akela-api/')) return;

  // Only handle requests under /pack/ — stay out of the way of the API and
  // other services on the same origin.
  if (!url.pathname.startsWith('/pack/')) return;

  // Navigations: network-first, fall back to cached index.html for offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/pack/index.html'))
    );
    return;
  }

  // Static assets (hashed JS/CSS/images): cache-first, with network update.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networked = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || networked;
    })
  );
});

// ── Web Push ─────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let payload = { title: 'Akela', body: 'You have a new notification' };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const title = payload.title || 'Akela';
  const options = {
    body: payload.body || '',
    icon: '/pack/app-icon.svg',
    badge: '/pack/app-icon.svg',
    tag: payload.tag || 'akela',
    data: { url: payload.url || '/pack/' },
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/pack/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If the dashboard is already open in a tab, focus it and navigate there.
      for (const client of clientList) {
        if (client.url.includes('/pack/') && 'focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      // Otherwise open a new window.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
