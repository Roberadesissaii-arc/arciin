/**
 * Socket.IO URL for browser clients (Events monitor, SocketProvider).
 *
 * When NEXT_PUBLIC_SOCKET_URL is unset, the app connects via the Next.js origin
 * (/socket.io is rewritten to the API). SSR must use the same default as the
 * first client paint to avoid hydration mismatches.
 */
export function getSocketUrlSsrDefault(): string {
  const explicit = process.env.NEXT_PUBLIC_SOCKET_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")

  const publicOrigin = process.env.NEXT_PUBLIC_ARCIIN_PUBLIC_URL?.trim()
  if (publicOrigin) return publicOrigin.replace(/\/$/, "")

  return "http://localhost:3000"
}

/** Resolved URL for Socket.IO (browser: always same-origin so /socket.io rewrite works). */
export function getClientSocketUrl(): string {
  if (typeof window !== "undefined") {
    const explicit = process.env.NEXT_PUBLIC_SOCKET_URL?.trim()
    if (explicit) {
      try {
        const explicitOrigin = new URL(explicit.replace(/\/$/, "")).origin
        if (explicitOrigin === window.location.origin) {
          return explicitOrigin
        }
      } catch {
        // ignore — fall through to current page origin
      }
    }
    return window.location.origin
  }

  return getSocketUrlSsrDefault()
}
