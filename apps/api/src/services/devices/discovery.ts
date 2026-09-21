import { randomUUID } from "node:crypto"

import {
  APP_VERSION,
  ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION,
  ARCIIN_COMPUTER_BACKUP_PROTOCOL_VERSION,
  ARCIIN_DEVICE_PROTOCOL_VERSION,
  ARCIIN_DISCOVERY_SERVICE,
  ARCIIN_MDNS_SERVICE_TYPE,
  buildMdnsAdvertisementRecord,
  discoveryManifestLooksUnsafe,
} from "@arciin/config"
import type { PrismaClient } from "@prisma/client"
import type { ArciinDiscoveryManifest } from "@arciin/types"
import type { FastifyRequest } from "fastify"

import { resolveLocalAccessUrls } from "@/services/remote-access/local-access-urls"

const PUBLIC_SERVER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function ensureDiscoveryServerId(prisma: PrismaClient): Promise<string | null> {
  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) return null
  if (instance.discoveryServerId && PUBLIC_SERVER_ID_RE.test(instance.discoveryServerId)) {
    return instance.discoveryServerId
  }

  const serverId = randomUUID()
  await prisma.instanceConfig.update({
    where: { id: instance.id },
    data: { discoveryServerId: serverId },
  })
  return serverId
}

function requestOrigin(request: FastifyRequest): string | null {
  const protoHeader = request.headers["x-forwarded-proto"]
  const proto =
    typeof protoHeader === "string" && protoHeader.split(",")[0]?.trim() === "https"
      ? "https"
      : request.protocol === "https"
        ? "https"
        : "http"
  const hostHeader = request.headers["x-forwarded-host"] ?? request.headers.host
  const host = typeof hostHeader === "string" ? hostHeader.split(",")[0]?.trim() : null
  if (!host) return null
  if (/localhost|127\.0\.0\.1|::1|0\.0\.0\.0/i.test(host)) return null
  return `${proto}://${host}`
}

export function resolveDiscoveryWebUrl(request?: FastifyRequest): string {
  const local = resolveLocalAccessUrls()
  if (local.primaryLanUrl) return local.primaryLanUrl
  const origin = request ? requestOrigin(request) : null
  if (origin) return origin
  return local.localUrl
}

export async function buildDiscoveryManifest(
  prisma: PrismaClient,
  request?: FastifyRequest,
): Promise<ArciinDiscoveryManifest> {
  const instance = await prisma.instanceConfig.findFirst()
  const serverId = instance ? await ensureDiscoveryServerId(prisma) : randomUUID()
  const pairingAvailable = Boolean(instance)
  const webUrl = resolveDiscoveryWebUrl(request)

  return {
    service: ARCIIN_DISCOVERY_SERVICE,
    protocolVersion: ARCIIN_DEVICE_PROTOCOL_VERSION,
    serverId: serverId ?? randomUUID(),
    instanceName: instance?.instanceName || "Arciin",
    version: APP_VERSION,
    pairingSupported: true,
    pairingAvailable,
    webUrl,
    mdns: {
      serviceType: `${ARCIIN_MDNS_SERVICE_TYPE}.local`,
      advertised: false,
    },
    capabilities: {
      computerBackup: {
        supported: true,
        protocolVersion: ARCIIN_COMPUTER_BACKUP_PROTOCOL_VERSION,
      },
      aiDesktopTools: {
        supported: true,
        protocolVersion: ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION,
      },
    },
  }
}

export function discoveryHasForbiddenFields(manifest: ArciinDiscoveryManifest): boolean {
  return discoveryManifestLooksUnsafe(JSON.stringify(manifest))
}

export function mdnsTxtForManifest(manifest: ArciinDiscoveryManifest) {
  return buildMdnsAdvertisementRecord({
    protocolVersion: manifest.protocolVersion,
    serverId: manifest.serverId,
  })
}
