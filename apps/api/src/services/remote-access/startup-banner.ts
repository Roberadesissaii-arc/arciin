/**
 * The lines the API prints when it starts.
 *
 * The banner listed every non-internal IPv4 address the kernel reported —
 * Docker bridges included — and then printed ARCIIN_PUBLIC_URL verbatim. On
 * a host whose DHCP lease had moved from 192.168.4.53 to 192.168.4.21 it
 * therefore advertised a dead address as "Public" while every other surface
 * (discovery, Settings → Domain, mobile pairing) had already moved on. The
 * LAN rows now come from the same resolver those surfaces use, and a
 * configured private address the machine no longer holds is called out
 * instead of repeated.
 */
export function startupBannerLines(input: {
  appVersion: string
  apiPort: number | string
  /** From getLanIpv4Addresses(): loopback, container bridges and stale values already removed. */
  lanHosts: string[]
  publicUrl: string
}): { info: string[]; warnings: string[] } {
  const info = [
    "─────────────────────────────────────────",
    `  Arciin API v${input.appVersion} — ready`,
    `  Local:    http://127.0.0.1:${input.apiPort}`,
    ...input.lanHosts.map((host) => `  Network:  http://${host}:${input.apiPort}`),
    `  Public:   ${input.publicUrl}`,
    "─────────────────────────────────────────",
  ]
  const warnings: string[] = []
  const configuredHost = privateIpv4Host(input.publicUrl)
  if (configuredHost && !input.lanHosts.includes(configuredHost)) {
    warnings.push(
      `ARCIIN_PUBLIC_URL names ${configuredHost}, which this machine does not hold` +
        (input.lanHosts[0] ? ` (it is on ${input.lanHosts[0]})` : "") +
        ". LAN addresses are detected automatically; update ARCIIN_PUBLIC_URL or set ARCIIN_ADVERTISED_LAN to override.",
    )
  }
  return { info, warnings }
}

function privateIpv4Host(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  return isPrivate ? host : null
}
