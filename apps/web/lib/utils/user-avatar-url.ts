/**
 * Avatar URLs must stay relative (/api/...) so SSR and the browser use the same origin
 * (Next.js rewrites /api → API). Absolute URLs cause hydration mismatches on LAN installs.
 */
export function resolveUserAvatarUrl(
  avatarUrl: string | null | undefined,
  cacheKey?: string,
): string | null {
  if (!avatarUrl?.trim()) return null

  let path = avatarUrl.trim()
  if (!path.startsWith("/")) {
    path = path.startsWith("api/") ? `/${path}` : `/api/${path.replace(/^\/?api\//, "")}`
  }

  if (!cacheKey) return path
  const sep = path.includes("?") ? "&" : "?"
  return `${path}${sep}v=${encodeURIComponent(cacheKey)}`
}
