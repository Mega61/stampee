/* Stampee service worker — offline public card (docs/CARD_ENGAGEMENT_PLAN.md §7.2).
 *
 * Hand-written on purpose (no Workbox). Registered from index.tsx only on
 * public card routes (`/:slug/:uniqueId`), with scope `/`, but it only ever
 * answers three kinds of GET requests and lets everything else hit the
 * network untouched:
 *
 *   1. Navigations to a public card route → network-first, cached app shell
 *      as the offline fallback.
 *   2. Same-origin `/assets/*` (content-hashed by Vite) → cache-first.
 *   3. The public card API (`…/public/cards/:slug/:uniqueId`, any origin) →
 *      network-first, falling back to the LAST successful response for that
 *      card, so the QR still shows at the counter with no signal.
 *
 * Bump VERSION to drop every old cache on the next activate.
 */
const VERSION = 'v1';
const SHELL_CACHE = `stampee-shell-${VERSION}`;
const ASSET_CACHE = `stampee-assets-${VERSION}`;
const CARD_CACHE = `stampee-cards-${VERSION}`;
const CACHES = [SHELL_CACHE, ASSET_CACHE, CARD_CACHE];
const SHELL_KEY = '/index.html';
const MAX_ASSETS = 80;

// Keep in sync with isPublicCardPath (lib/card/installPrompt.ts).
const RESERVED_FIRST = new Set(['active', 'preview', 'editor', 'dev', 'assets', 'api', 'login', 'forgot-password']);
const RESERVED_SECOND = new Set(['staff', 'scan', 'join']);
const isCardPage = (url) => {
  if (url.origin !== self.location.origin) return false;
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.length === 2 && !RESERVED_FIRST.has(parts[0]) && !RESERVED_SECOND.has(parts[1]);
};
const isAsset = (url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/');
// Exactly the card endpoint — not /views, /manifest.webmanifest, /game…
const CARD_API_RE = /\/public\/cards\/[^/]+\/[^/]+\/?$/;
const isCardApi = (url) => CARD_API_RE.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(SHELL_KEY, { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('stampee-') && !CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const trimCache = async (cacheName, max) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
};

const cacheFirst = async (request) => {
  const cache = await caches.open(ASSET_CACHE);
  // Hashed URLs never change content, so ignore `Vary: Origin` (module
  // scripts carry an Origin header the precached entries don't).
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    void trimCache(ASSET_CACHE, MAX_ASSETS);
  }
  return response;
};

const navigation = async (request) => {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
      await cache.put(SHELL_KEY, response.clone());
    }
    return response;
  } catch (err) {
    const shell = await cache.match(SHELL_KEY, { ignoreVary: true });
    if (shell) return shell;
    throw err;
  }
};

// Cache key ignores the query string (cache busters) and credentials.
const cardKey = (url) => `${url.origin}${url.pathname.replace(/\/$/, '')}`;

const cardApi = async (request, url) => {
  const cache = await caches.open(CARD_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cardKey(url), response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cardKey(url), { ignoreVary: true });
    if (cached) return cached;
    throw err;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (request.mode === 'navigate') {
    if (isCardPage(url)) event.respondWith(navigation(request));
    return;
  }
  if (isAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isCardApi(url)) event.respondWith(cardApi(request, url));
});

// The first visit loads before the worker controls the page, so the page
// sends the assets (and card API URL) it already fetched to be cached now.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'stampee:precache' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      for (const raw of data.urls.slice(0, MAX_ASSETS)) {
        let url;
        try {
          url = new URL(raw, self.location.origin);
        } catch {
          continue;
        }
        try {
          if (isAsset(url)) {
            const cache = await caches.open(ASSET_CACHE);
            if (!(await cache.match(url.href, { ignoreVary: true }))) await cache.add(url.href);
          } else if (isCardApi(url)) {
            const cache = await caches.open(CARD_CACHE);
            const response = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
            if (response.ok) await cache.put(cardKey(url), response);
          }
        } catch {
          // best effort
        }
      }
    })(),
  );
});
