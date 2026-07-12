import os from "node:os"

import { isSelfHostedLanHostname } from "@arciin/shared"

import { apiConfig } from "@/config"

export type LocalAccessUrls = {
  webPort: string
  loopbackUrl: string
  lanUrls: string[]
  /** Best URL for other devices on the same network. */
  primaryLanUrl: string | null
  /** Primary local URL (LAN if available, else loopback). */
  localUrl: string
}

function getLanIpv4Addresses(): string[] {
  const ips: string[] = []
  for (const [name, iface] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|veth|br-|virbr)/i.test(name)) continue
    for (const addr of iface ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue
      const ip = addr.address
      if (ip.startsWith("169.254.")) continue
      ips.push(ip)
    }
  }
  return [...new Set(ips)]
}

function isApiPort(port: string): boolean {
  const apiPort = String(apiConfig.API_PORT)
  return port === apiPort || port === "4000" || port === "4001"
}

/** Next.js web UI port — never the Fastify API port. */
export function resolveWebPort(): string {
  const fromEnv = process.env.ARCIIN_WEB_PORT?.trim() || process.env.PORT?.trim()
  if (fromEnv && !isApiPort(fromEnv)) {
    return fromEnv
  }

  try {
    const u = new URL(apiConfig.ARCIIN_PUBLIC_URL)
    if (u.port && !isApiPort(u.port)) {
      return u.port
    }
  } catch {
    /* fall through */
  }

  return "3000"
}

/** Mobile PWA listen port — separate from desktop web (ARCIIN_WEB_PORT). */
export function resolveMobileWebPort(): string {
  const fromEnv = process.env.ARCIIN_MOBILE_PORT?.trim()
  if (fromEnv && !isApiPort(fromEnv)) {
    return fromEnv
  }

  try {
    const raw = process.env.ARCIIN_MOBILE_PUBLIC_URL?.trim()
    if (raw) {
      const u = new URL(raw)
      if (u.port && !isApiPort(u.port)) {
        return u.port
      }
    }
  } catch {
    /* fall through */
  }

  return resolveWebPort()
}

export function resolveMobileLocalAccessUrls(): LocalAccessUrls {
  const webPort = resolveMobileWebPort()
  const loopbackUrl = `http://127.0.0.1:${webPort}`
  const lanUrls = new Set<string>()

  try {
    const raw = process.env.ARCIIN_MOBILE_PUBLIC_URL?.trim()
    if (raw) {
      const u = new URL(raw)
      if (isSelfHostedLanHostname(u.hostname)) {
        const port = u.port && !isApiPort(u.port) ? u.port : webPort
        lanUrls.add(`http://${u.hostname}:${port}`)
      }
    }
  } catch {
    /* ignore */
  }

  for (const ip of getLanIpv4Addresses()) {
    lanUrls.add(`http://${ip}:${webPort}`)
  }

  const preferredHost = (() => {
    try {
      const raw = process.env.ARCIIN_MOBILE_PUBLIC_URL?.trim()
      if (!raw) return null
      const u = new URL(raw)
      return isSelfHostedLanHostname(u.hostname) ? u.hostname : null
    } catch {
      return null
    }
  })()

  const lanList = [...lanUrls].sort((a, b) => {
    if (preferredHost) {
      const ah = new URL(a).hostname
      const bh = new URL(b).hostname
      if (ah === preferredHost && bh !== preferredHost) return -1
      if (bh === preferredHost && ah !== preferredHost) return 1
    }
    return a.localeCompare(b)
  })
  const primaryLanUrl = lanList[0] ?? null

  return {
    webPort,
    loopbackUrl,
    lanUrls: lanList,
    primaryLanUrl,
    localUrl: primaryLanUrl ?? loopbackUrl,
  }
}

export function resolveLocalAccessUrls(): LocalAccessUrls {
  const webPort = resolveWebPort()
  const loopbackUrl = `http://127.0.0.1:${webPort}`
  const lanUrls = new Set<string>()

  try {
    const u = new URL(apiConfig.ARCIIN_PUBLIC_URL)
    if (isSelfHostedLanHostname(u.hostname)) {
      const port = u.port && !isApiPort(u.port) ? u.port : webPort
      lanUrls.add(`http://${u.hostname}:${port}`)
    }
  } catch {
    /* ignore */
  }

  for (const ip of getLanIpv4Addresses()) {
    lanUrls.add(`http://${ip}:${webPort}`)
  }

  const preferredHost = (() => {
    try {
      const u = new URL(apiConfig.ARCIIN_PUBLIC_URL)
      return isSelfHostedLanHostname(u.hostname) ? u.hostname : null
    } catch {
      return null
    }
  })()

  const lanList = [...lanUrls].sort((a, b) => {
    if (preferredHost) {
      const ah = new URL(a).hostname
      const bh = new URL(b).hostname
      if (ah === preferredHost && bh !== preferredHost) return -1
      if (bh === preferredHost && ah !== preferredHost) return 1
    }
    return a.localeCompare(b)
  })
  const primaryLanUrl = lanList[0] ?? null

  return {
    webPort,
    loopbackUrl,
    lanUrls: lanList,
    primaryLanUrl,
    localUrl: primaryLanUrl ?? loopbackUrl,
  }
}
