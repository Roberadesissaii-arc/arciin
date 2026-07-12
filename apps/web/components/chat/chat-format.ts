/** Chat-local formatting + REST base helpers. */

export const ASSET_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

/** Same-origin REST prefix as the in-app API client (for chat context / examples). */
export function getBrowserRestApiBase(): string {
  const api = ASSET_API_BASE.replace(/\/$/, "")
  if (api.startsWith("http")) return api
  if (typeof window !== "undefined") {
    return `${window.location.origin}${api.startsWith("/") ? api : `/${api}`}`
  }
  return api
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)   return "just now"
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}
