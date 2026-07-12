import { randomUUID } from "node:crypto"

import type { FastifyInstance, FastifyRequest } from "fastify"
import type { RealtimeEvent } from "@arciin/shared"

import { isSelfHostedLanHostname } from "@arciin/shared"

import { apiConfig } from "@/config"
import {
  resolveLocalAccessUrls,
  resolveMobileLocalAccessUrls,
} from "@/services/remote-access/local-access-urls"

export type MobileServerUrls = {
  webUrl: string
  apiBaseUrl: string
  socketUrl: string
  instanceName: string
  version: string
  /** Origin derived from the incoming HTTP request (useful on LAN when public URL is still localhost). */
  requestOrigin: string | null
}

export type MobileDiscoverPayload = MobileServerUrls & {
  instanceId: string | null
  /** HTTPS tunnel or fixed domain from server settings (stable across LAN requests). */
  canonicalPublicUrl: string | null
  canonicalApiBaseUrl: string | null
  canonicalSocketUrl: string | null
  /** LAN URLs other devices can use to reach this instance on the same network. */
  lanUrls: string[]
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "")
}

function isApiPort(port: string): boolean {
  const apiPort = String(apiConfig.API_PORT)
  return port === apiPort || port === "4000" || port === "4001"
}

function requestOriginFromHeaders(request?: FastifyRequest): string | null {
  if (!request) return null
  const forwardedHost = request.headers["x-forwarded-host"]
  const host =
    (typeof forwardedHost === "string" ? forwardedHost.split(",")[0]?.trim() : null) ||
    request.headers.host
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

/** Public/tunnel URLs stored on the instance (not overridden by the caller's LAN origin). */
export async function resolveCanonicalPublicServerUrls(
  prisma: Parameters<typeof resolveMobileServerUrls>[0],
): Promise<MobileServerUrls | null> {
  const instance = await prisma.instanceConfig.findFirst()
  const config = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
  const mobilePublicUrl =
    typeof config.mobilePublicUrl === "string" ? stripTrailingSlash(config.mobilePublicUrl) : null
  const instancePublic = instance?.publicUrl ? stripTrailingSlash(instance.publicUrl) : null

  const publicWeb =
    (mobilePublicUrl && isHttpsPublicOrigin(mobilePublicUrl) ? mobilePublicUrl : null) ??
    (instancePublic && isHttpsPublicOrigin(instancePublic) ? instancePublic : null)

  if (!publicWeb) return null

  return {
    webUrl: publicWeb,
    apiBaseUrl: `${publicWeb}/api`,
    socketUrl: publicWeb,
    instanceName: instance?.instanceName ?? "Arciin",
    version: apiConfig.appVersion,
    requestOrigin: null,
  }
}

export async function buildMobileDiscoverPayload(
  prisma: {
    instanceConfig: {
      findFirst: () => Promise<{
        id: string
        instanceName: string
        publicUrl: string | null
        remoteAccessConfig: unknown
      } | null>
    }
  },
  request?: FastifyRequest,
): Promise<MobileDiscoverPayload> {
  const instance = await prisma.instanceConfig.findFirst()
  const urls = await resolveMobileServerUrls(prisma, request)
  const canonical = await resolveCanonicalPublicServerUrls(prisma)
  const mobileLocal = resolveMobileLocalAccessUrls()
  const desktopLocal = resolveLocalAccessUrls()

  return {
    ...urls,
    instanceId: instance?.id ?? null,
    canonicalPublicUrl: canonical?.webUrl ?? null,
    canonicalApiBaseUrl: canonical?.apiBaseUrl ?? null,
    canonicalSocketUrl: canonical?.socketUrl ?? null,
    lanUrls: mobileLocal.lanUrls.length ? mobileLocal.lanUrls : desktopLocal.lanUrls,
  }
}

export async function broadcastInstanceUrlsUpdated(
  fastify: FastifyInstance,
  instanceId: string,
  options?: { previousPublicUrl?: string | null },
) {
  const payload = await buildMobileDiscoverPayload(fastify.prisma)
  const canonical = await resolveCanonicalPublicServerUrls(fastify.prisma)
  const urls =
    canonical && canonical.webUrl.startsWith("https://") ? canonical : payload

  const event: RealtimeEvent = {
    id: randomUUID(),
    type: "instance.urls.updated",
    instanceId,
    createdAt: new Date().toISOString(),
    data: {
      webUrl: urls.webUrl,
      apiBaseUrl: urls.apiBaseUrl,
      socketUrl: urls.socketUrl,
      instanceName: urls.instanceName,
      version: urls.version,
      previousPublicUrl: options?.previousPublicUrl ?? null,
    },
  }

  fastify.io.to(`instance:${instanceId}`).emit(event.type, event)
  await fastify.publishRealtimeEvent(event)
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
  const mobileLocal = resolveMobileLocalAccessUrls()

  if (requestOrigin) {
    try {
      const origin = stripTrailingSlash(requestOrigin)
      const parsed = new URL(origin)
      const { hostname } = parsed
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80")

      if (isApiPort(port)) {
        if (mobileLocal.primaryLanUrl) {
          const mobileOrigin = stripTrailingSlash(mobileLocal.primaryLanUrl)
          return {
            webUrl: mobileOrigin,
            apiBaseUrl: `${mobileOrigin}/api`,
            socketUrl: mobileOrigin,
            instanceName: instance?.instanceName ?? "Arciin",
            version: apiConfig.appVersion,
            requestOrigin: mobileOrigin,
          }
        }
      } else if (
        isSelfHostedLanHostname(hostname) ||
        port === mobileLocal.webPort
      ) {
        return {
          webUrl: origin,
          apiBaseUrl: `${origin}/api`,
          socketUrl: origin,
          instanceName: instance?.instanceName ?? "Arciin",
          version: apiConfig.appVersion,
          requestOrigin: origin,
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

  if (mobileLocal.primaryLanUrl) {
    const mobileOrigin = stripTrailingSlash(mobileLocal.primaryLanUrl)
    return {
      webUrl: mobileOrigin,
      apiBaseUrl: `${mobileOrigin}/api`,
      socketUrl: mobileOrigin,
      instanceName: instance?.instanceName ?? "Arciin",
      version: apiConfig.appVersion,
      requestOrigin: mobileOrigin,
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
