/**
 * LAN address selection for setup, mobile pairing, and Settings → Domain.
 *
 * Policy (deterministic, not Object.keys order):
 *
 *  1. An explicit advertised LAN host wins when it is a usable private IPv4.
 *  2. Remote/public hostnames are never treated as LAN.
 *  3. Loopback, link-local, Docker/container bridges, and obvious virtual
 *     NICs are rejected.
 *  4. Remaining RFC1918 IPv4 addresses are ranked: 192.168, then 10/8, then
 *     other private ranges. VPNs sort after physical interfaces.
 *  5. Multiple valid addresses are all returned. Index 0 is LAN 1 (primary).
 */

export type LanInterfaceAddress = {
  name: string
  address: string
  family: "IPv4" | "IPv6" | string
  internal: boolean
  cidr?: string | null
}

export type LanSelectionOptions = {
  interfaces: LanInterfaceAddress[]
  /** True when the process is inside a container (/.dockerenv or /data/arciin). */
  inContainer?: boolean
  /** Hostname from ARCIIN_PUBLIC_URL / ARCIIN_MOBILE_PUBLIC_URL when it is LAN. */
  advertisedLanHost?: string | null
  /** Dedicated LAN override (ARCIIN_ADVERTISED_LAN). Takes precedence. */
  advertisedLanOverride?: string | null
}

export type LanRejection = {
  address: string
  interfaceName: string
  reason: string
}

export type LanSelection = {
  selected: string[]
  primary: string | null
  rejected: LanRejection[]
}

const DOCKER_IFACE = /^(docker|veth|br-|virbr|cni|flannel|kube|calico|nodelocaldns)/i
const VPN_IFACE = /^(tun|tap|wg|utun|ppp|tailscale|zt)/i

function ipv4Parts(address: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (!match) return null
  const parts = match.slice(1).map(Number) as [number, number, number, number]
  if (parts.some((part) => part < 0 || part > 255)) return null
  return parts
}

export function isIpv4Loopback(address: string): boolean {
  const parts = ipv4Parts(address)
  return parts ? parts[0] === 127 : address === "localhost"
}

export function isIpv4LinkLocal(address: string): boolean {
  const parts = ipv4Parts(address)
  return Boolean(parts && parts[0] === 169 && parts[1] === 254)
}

/** Docker's default bridge (docker0) and typical compose networks when they
 *  appear as the process's own address inside a container. */
export function isDockerDefaultBridgeIpv4(address: string): boolean {
  const parts = ipv4Parts(address)
  return Boolean(parts && parts[0] === 172 && parts[1] === 17)
}

export function isRfc1918Ipv4(address: string): boolean {
  const parts = ipv4Parts(address)
  if (!parts) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

/**
 * Hostnames that may be advertised as LAN.
 *
 * 172.16/12 is private, but 172.17/16 is Docker's default bridge and must not
 * be labelled a customer LAN address.
 */
export function isUsableLanOverrideHostname(hostname: string, inContainer = false): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host || host === "localhost" || isIpv4Loopback(host) || isIpv4LinkLocal(host)) {
    return false
  }
  if (isDockerDefaultBridgeIpv4(host)) return false
  if (inContainer && isRfc1918Ipv4(host) && host.startsWith("172.")) return false
  const parts = ipv4Parts(host)
  if (!parts) return false
  return isRfc1918Ipv4(host)
}

function interfaceKind(name: string): "docker" | "vpn" | "virtual" | "physical" {
  if (DOCKER_IFACE.test(name)) return "docker"
  if (VPN_IFACE.test(name)) return "vpn"
  if (/^(lo|dummy)/i.test(name)) return "virtual"
  return "physical"
}

function rejectReason(
  iface: LanInterfaceAddress,
  inContainer: boolean,
): string | null {
  const { name, address, family, internal } = iface
  if (family !== "IPv4" && family !== "4") return "non-ipv4"
  if (internal) return "internal"
  if (isIpv4Loopback(address)) return "loopback"
  if (isIpv4LinkLocal(address)) return "link-local"
  const kind = interfaceKind(name)
  if (kind === "docker") return "docker-or-bridge-interface"
  if (kind === "virtual") return "virtual-interface"
  if (isDockerDefaultBridgeIpv4(address)) return "docker-default-bridge"
  if (inContainer) return "container-only-network"
  if (!isRfc1918Ipv4(address)) return "not-private-lan"
  return null
}

function classRank(address: string): number {
  const parts = ipv4Parts(address)
  if (!parts) return 90
  if (parts[0] === 192 && parts[1] === 168) return 10
  if (parts[0] === 10) return 20
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 30
  return 90
}

function kindRank(name: string): number {
  return interfaceKind(name) === "vpn" ? 40 : 0
}

function compareIpv4(a: string, b: string): number {
  const left = ipv4Parts(a)
  const right = ipv4Parts(b)
  if (!left || !right) return a.localeCompare(b)
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return left[i]! - right[i]!
  }
  return 0
}

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname
    }
  } catch {
    return null
  }
  return trimmed.replace(/\/.*$/, "")
}

export function selectLanIpv4Addresses(options: LanSelectionOptions): LanSelection {
  const inContainer = Boolean(options.inContainer)
  const rejected: LanRejection[] = []
  const accepted: Array<{ address: string; name: string }> = []

  const overrideHost =
    normalizeHost(options.advertisedLanOverride) ?? normalizeHost(options.advertisedLanHost)

  for (const iface of options.interfaces) {
    const reason = rejectReason(iface, inContainer)
    if (reason) {
      rejected.push({ address: iface.address, interfaceName: iface.name, reason })
      continue
    }
    accepted.push({ address: iface.address, name: iface.name })
  }

  const unique = new Map<string, string>()
  for (const item of accepted) {
    if (!unique.has(item.address)) unique.set(item.address, item.name)
  }

  const selected = [...unique.entries()]
    .map(([address, name]) => ({ address, name }))
    .sort((a, b) => {
      if (overrideHost) {
        if (a.address === overrideHost && b.address !== overrideHost) return -1
        if (b.address === overrideHost && a.address !== overrideHost) return 1
      }
      const kind = kindRank(a.name) - kindRank(b.name)
      if (kind !== 0) return kind
      const cls = classRank(a.address) - classRank(b.address)
      if (cls !== 0) return cls
      const numeric = compareIpv4(a.address, b.address)
      if (numeric !== 0) return numeric
      return a.name.localeCompare(b.name)
    })
    .map((item) => item.address)

  if (overrideHost && isUsableLanOverrideHostname(overrideHost, inContainer)) {
    if (!selected.includes(overrideHost)) {
      /**
       * The override names an address this machine does not currently hold.
       *
       * Inside a container that is expected — the host's LAN address is not on
       * any interface we can see — so the override is still the best answer.
       *
       * Outside one it means the configured value has gone stale, usually
       * because DHCP moved the server after the value was set. The override is
       * always an RFC1918 IPv4 literal (isUsableLanOverrideHostname rejects
       * hostnames), so "not on any interface" is decidable rather than a guess.
       * Advertising it anyway put an address that answers nothing at the front
       * of the list, where it became `primary` and was published as the
       * server's current address in the discovery manifest and Remote Access.
       * A real interface address is worth more than a configured one that has
       * expired.
       */
      if (inContainer) {
        selected.unshift(overrideHost)
      } else {
        rejected.push({
          address: overrideHost,
          interfaceName: "(configured override)",
          reason: "override-not-on-any-interface",
        })
      }
    }
  }

  return {
    selected,
    primary: selected[0] ?? null,
    rejected,
  }
}

export function snapshotOsNetworkInterfaces(
  networkInterfaces: () => NodeJS.Dict<
    Array<{ address: string; family?: string | number; internal?: boolean; cidr?: string | null }>
  >,
): LanInterfaceAddress[] {
  const out: LanInterfaceAddress[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const family = addr.family === 4 || addr.family === "IPv4" ? "IPv4" : String(addr.family ?? "")
      out.push({
        name,
        address: addr.address,
        family,
        internal: Boolean(addr.internal),
        cidr: addr.cidr ?? null,
      })
    }
  }
  return out
}
