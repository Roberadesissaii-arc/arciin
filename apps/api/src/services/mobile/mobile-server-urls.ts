import type { FastifyRequest } from "fastify"

import { isSelfHostedLanHostname } from "@arciin/shared"

import { apiConfig } from "@/config"

export type MobileServerUrls = {
  webUrl: string
  apiBaseUrl: string
  socketUrl: string
  instanceName: string
  version: string
  /** Origin derived from the incoming HTTP request (useful on LAN when public URL is still localhost). */
  requestOrigin: string | null
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "")
}

function requestOriginFromHeaders(request?: FastifyRequest): string | null {
  if (!request) return null
  const host = request.headers.host
  if (!host || typeof host !== "string") return null
  const forwarded = request.headers["x-forwarded-proto"]
  const proto =
    typeof forwarded === "string" && forwarded.split(",")[0]?.trim()
      ? forwarded.split(",")[0]!.trim()
      : "http"
  return `${proto}://${host}`
}

function isHttpsPublicOrigin(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "https:" && !isLoopbackHost(u.hostname)
  } catch {
    return false
  }
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === "localhost" || h === "127.0.0.1" || h === "::1"
}

export async function resolveMobileServerUrls(
  prisma: {
    instanceConfig: {
      findFirst: () => Promise<{
        instanceName: string
        publicUrl: string | null
        remoteAccessConfig: unknown
      } | null>
    }
  },
  request?: FastifyRequest,
): Promise<MobileServerUrls> {
  const instance = await prisma.instanceConfig.findFirst()
  const config = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
  const mobilePublicUrl =
    typeof config.mobilePublicUrl === "string" ? stripTrailingSlash(config.mobilePublicUrl) : null
  const instancePublic = instance?.publicUrl ? stripTrailingSlash(instance.publicUrl) : null
  const requestOrigin = requestOriginFromHeaders(request)

  if (requestOrigin) {
    try {
      const origin = stripTrailingSlash(requestOrigin)
      const { hostname } = new URL(origin)
      if (isSelfHostedLanHostname(hostname)) {
        return {
          webUrl: origin,
          apiBaseUrl: `${origin}/api`,
          socketUrl: origin,
          instanceName: instance?.instanceName ?? "Arciin",
          version: apiConfig.appVersion,
          requestOrigin,
        }
      }
    } catch {
      /* fall through */
    }
  }

  const publicWeb =
    (mobilePublicUrl && isHttpsPublicOrigin(mobilePublicUrl) ? mobilePublicUrl : null) ??
    (instancePublic && isHttpsPublicOrigin(instancePublic) ? instancePublic : null)

  if (publicWeb) {
    return {
      webUrl: publicWeb,
      apiBaseUrl: `${publicWeb}/api`,
      socketUrl: publicWeb,
      instanceName: instance?.instanceName ?? "Arciin",
      version: apiConfig.appVersion,
      requestOrigin,
    }
  }

  const webUrl = stripTrailingSlash(instancePublic || apiConfig.ARCIIN_PUBLIC_URL)
  const apiBaseUrl = `${stripTrailingSlash(apiConfig.ARCIIN_API_URL)}/api`
  const socketUrl = stripTrailingSlash(apiConfig.ARCIIN_API_URL)

  return {
    webUrl,
    apiBaseUrl,
    socketUrl,
    instanceName: instance?.instanceName ?? "Arciin",
    version: apiConfig.appVersion,
    requestOrigin,
  }
}
