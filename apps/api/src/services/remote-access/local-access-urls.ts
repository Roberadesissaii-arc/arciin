import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  buildAdvertisedLocalAccessUrls,
  isUsableLanOverrideHostname,
  resolveAdvertisedHttpPort,
  resolveAdvertisedMobileHttpPort,
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

/**
 * Internal Next.js listen port (tunnel target / process bind).
 * Customer-facing LAN URLs must use `resolveCustomerFacingHttpPort`.
 */
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

function advertisedPortInput() {
  return {
    publicUrl: process.env.ARCIIN_PUBLIC_URL?.trim() || apiConfig.ARCIIN_PUBLIC_URL,
    mobilePublicUrl: process.env.ARCIIN_MOBILE_PUBLIC_URL,
    httpPort: process.env.ARCIIN_HTTP_PORT,
    webPort: process.env.ARCIIN_WEB_PORT,
    processPort: process.env.PORT,
    apiPort: apiConfig.API_PORT,
    inContainer: isDockerRuntime(),
  }
}

/** Customer-facing HTTP port (Caddy / published HTTP), not the Next.js listen port. */
export function resolveCustomerFacingHttpPort(): string {
  return resolveAdvertisedHttpPort(advertisedPortInput())
}

export function resolveMobileLocalAccessUrls(): LocalAccessUrls {
  const webPort = resolveAdvertisedMobileHttpPort(advertisedPortInput())
  const preferredHost = advertisedLanHostFromValue(process.env.ARCIIN_MOBILE_PUBLIC_URL)
  return buildAdvertisedLocalAccessUrls({
    lanHosts: getLanIpv4Addresses({ advertisedLanHost: preferredHost }),
    preferredHost,
    port: webPort,
  })
}

export function resolveLocalAccessUrls(): LocalAccessUrls {
  const webPort = resolveCustomerFacingHttpPort()
  const preferredHost = advertisedLanHostFromValue(
    process.env.ARCIIN_PUBLIC_URL?.trim() || apiConfig.ARCIIN_PUBLIC_URL,
  )
  return buildAdvertisedLocalAccessUrls({
    lanHosts: getLanIpv4Addresses({ advertisedLanHost: preferredHost }),
    preferredHost,
    port: webPort,
  })
}
