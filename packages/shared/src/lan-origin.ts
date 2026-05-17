/** Private/LAN hostnames for self-hosted HTTP (no TLS). */
export function isSelfHostedLanHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  return false
}

export function isSelfHostedLanOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return isSelfHostedLanHostname(hostname)
  } catch {
    return false
  }
}
