import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  isUsableLanOverrideHostname,
  selectLanIpv4Addresses,
  snapshotOsNetworkInterfaces,
} from "@arciin/config"

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

function isDockerRuntime(): boolean {
  if (process.env.ARCIIN_IN_CONTAINER === "1") return true
  if (path.resolve(apiConfig.dataDir) === "/data/arciin") return true
  try {
    return fs.existsSync("/.dockerenv")
  } catch {
    return false
  }
}

function hostnameFromMaybeUrl(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null
  const value = raw.trim()
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).hostname
  } catch {
    return null
  }
  return value.replace(/[:/].*$/, "")
}

function advertisedLanHostFromValue(raw: string | undefined | null): string | null {
  const hostname = hostnameFromMaybeUrl(raw)
  if (!hostname) return null
  return isUsableLanOverrideHostname(hostname, isDockerRuntime()) ? hostname : null
}

export function getLanIpv4Addresses(options?: {
  interfaces?: ReturnType<typeof snapshotOsNetworkInterfaces>
  inContainer?: boolean
  advertisedLanHost?: string | null
  advertisedLanOverride?: string | null
}): string[] {
  const inContainer = options?.inContainer ?? isDockerRuntime()
  const interfaces = options?.interfaces ?? snapshotOsNetworkInterfaces(() => os.networkInterfaces())
  const advertisedLanOverride =
    options?.advertisedLanOverride ?? advertisedLanHostFromValue(process.env.ARCIIN_ADVERTISED_LAN)
  const advertisedLanHost =
    options?.advertisedLanHost ?? advertisedLanHostFromValue(apiConfig.ARCIIN_PUBLIC_URL)
  const selection = selectLanIpv4Addresses({
    interfaces,
    inContainer,
    advertisedLanHost,
    advertisedLanOverride,
  })
  return selection.selected
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

function urlsFromLanIps(ips: string[], webPort: string, preferredHost: string | null): string[] {
  const lanUrls = new Set<string>()
  if (preferredHost) {
    lanUrls.add(`http://${preferredHost}:${webPort}`)
  }
  for (const ip of ips) {
    lanUrls.add(`http://${ip}:${webPort}`)
  }
  const preferred = preferredHost ? `http://${preferredHost}:${webPort}` : null
  return [...lanUrls].sort((a, b) => {
    if (preferred) {
      if (a === preferred && b !== preferred) return -1
      if (b === preferred && a !== preferred) return 1
    }
    return a.localeCompare(b, "en")
  })
}

export function resolveMobileLocalAccessUrls(): LocalAccessUrls {
  const webPort = resolveMobileWebPort()
  const loopbackUrl = `http://127.0.0.1:${webPort}`
  const preferredHost = advertisedLanHostFromValue(process.env.ARCIIN_MOBILE_PUBLIC_URL)
  const lanList = urlsFromLanIps(
    getLanIpv4Addresses({
      advertisedLanHost: preferredHost,
    }),
    webPort,
    preferredHost,
  )
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
  const preferredHost = advertisedLanHostFromValue(apiConfig.ARCIIN_PUBLIC_URL)
  const lanList = urlsFromLanIps(
    getLanIpv4Addresses({ advertisedLanHost: preferredHost }),
    webPort,
    preferredHost,
  )
  const primaryLanUrl = lanList[0] ?? null

  return {
    webPort,
    loopbackUrl,
    lanUrls: lanList,
    primaryLanUrl,
    localUrl: primaryLanUrl ?? loopbackUrl,
  }
}
