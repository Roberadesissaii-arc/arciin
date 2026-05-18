import type { FastifyRequest } from "fastify"

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

export async function resolveMobileServerUrls(
  prisma: { instanceConfig: { findFirst: () => Promise<{ instanceName: string; publicUrl: string | null } | null> } },
  request?: FastifyRequest,
): Promise<MobileServerUrls> {
  const instance = await prisma.instanceConfig.findFirst()
  const webUrl = stripTrailingSlash(instance?.publicUrl || apiConfig.ARCIIN_PUBLIC_URL)
  const apiBaseUrl = `${stripTrailingSlash(apiConfig.ARCIIN_API_URL)}/api`
  const socketUrl = stripTrailingSlash(apiConfig.ARCIIN_API_URL)

  return {
    webUrl,
    apiBaseUrl,
    socketUrl,
    instanceName: instance?.instanceName ?? "Arciin",
    version: apiConfig.appVersion,
    requestOrigin: requestOriginFromHeaders(request),
  }
}
