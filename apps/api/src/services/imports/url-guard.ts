/**
 * Basic SSRF guard for URL imports. Rejects non-http(s) URLs and hostnames that
 * clearly point at the local machine or private networks. This is a first-line
 * filter (hostname-based); the worker re-validates before fetching.
 */
export function isImportablePublicUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false

  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (!host) return false

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false
  }
  if (host === "metadata" || host === "metadata.google.internal") return false

  // Literal IPv4 in private / loopback / link-local ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 10) return false
    if (a === 127) return false
    if (a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
  }

  // IPv6 loopback / link-local / unique-local.
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return false
  }

  return true
}
