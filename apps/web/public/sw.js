/**
 * Arciin desktop service worker.
 *
 * The previous version served everything under /_next/static cache-first from a
 * cache named `arciin-web-v1`, and that name never changed. Cache-first is only
 * safe when a filename can never be reused for different bytes; the moment that
 * assumption is wrong — or a build reuses a chunk name — the browser pins the
 * old JavaScript permanently and a deploy appears to do nothing. There is no way
 * for the user to recover except clearing site data, which nobody thinks to do
 * because the page "looks fine".
 *
 * That failure is silent, indefinite, and looks exactly like the developer not
 * having shipped the change. It is not worth the milliseconds cache-first saves
 * on a server the user is usually on the same network as.
 *
 * So: network-first for build output, falling back to cache only when the
 * network fails. Offline still works from whatever was cached last; a deploy is
 * picked up on the next load, every time.
 */

const CACHE = "arciin-web-v2"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Drops arciin-web-v1 outright, which is what unsticks anyone currently
      // pinned to a stale bundle by the old policy.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/**
 * Let the page ask for a hard reset.
 *
 * Used by the "reload" affordance so a user who is somehow still stale has a
 * button rather than a DevTools instruction.
 */
self.addEventListener("message", (event) => {
  if (event.data === "arciin:clear-cache") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))))
  }
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return

  // Never intercept API, realtime, or auth traffic.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          if (fresh.ok) {
            const cache = await caches.open(CACHE)
            cache.put(request, fresh.clone())
          }
          return fresh
        } catch {
          // Offline: last known copy is better than a broken page.
          const cache = await caches.open(CACHE)
          const hit = await cache.match(request)
          if (hit) return hit
          throw new Error("offline and not cached")
        }
      })(),
    )
  }
})
