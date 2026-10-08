const CACHE_NAME = 'stampfy-static-v1';
const STATIC_FILES = ['/offline.html', '/pwa-icon.svg', '/pwa-icon-180.png', '/pwa-icon-192.png', '/pwa-icon-512.png', '/stampfy.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('stampfy-static-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/offline.html')) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || STATIC_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Stampfy';
  const destination = typeof payload.url === 'string' && payload.url.startsWith('/') && !payload.url.startsWith('//')
    ? payload.url
    : '/';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/pwa-icon.svg',
    badge: '/pwa-icon.svg',
    tag: typeof payload.tag === 'string' ? payload.tag : undefined,
    data: { url: destination },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.url === 'string' && event.notification.data.url.startsWith('/')
    ? event.notification.data.url
    : '/';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
