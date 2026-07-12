const CACHE = 'arciin-web-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return

  // Never intercept API, realtime, or auth traffic.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return

  // Cache-first for Next.js hashed static assets (JS/CSS/fonts — content-addressed, immutable).
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const resp = await fetch(request)
        if (resp.ok) cache.put(request, resp.clone())
        return resp
      })
    )
  }
})
