const API_BASE_PATH = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "/api"

export function getApiBasePath(): string {
  return API_BASE_PATH.replace(/\/$/, "")
}

/** Full REST prefix for scripts and curl (absolute when the UI is served over http(s)). */
export function getBrowserRestApiBase(): string {
  const api = getApiBasePath()
  if (api.startsWith("http")) return api
  if (typeof window !== "undefined") {
    return `${window.location.origin}${api.startsWith("/") ? api : `/${api}`}`
  }
  const publicUrl = process.env.NEXT_PUBLIC_ARCIIN_PUBLIC_URL?.trim()
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, "")}${api.startsWith("/") ? api : `/${api}`}`
  }
  return api
}
