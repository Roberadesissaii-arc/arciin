import type { FastifyInstance } from "fastify"

import { broadcastInstanceUrlsUpdated } from "@/services/mobile/mobile-server-urls"

export type RemoteAccessConfigJson = Record<string, unknown>

export function readRemoteAccessConfig(raw: unknown): RemoteAccessConfigJson {
  return (raw as RemoteAccessConfigJson | null) || {}
}

export function isCloudflareTunnelAutoStartEnabled(
  config: RemoteAccessConfigJson,
  remoteAccessMode: string | null | undefined,
): boolean {
  if (process.env.ARCIIN_TUNNEL_AUTOSTART === "false") return false
  if (process.env.ARCIIN_TUNNEL_AUTOSTART === "true") return true

  const tunnelMode =
    remoteAccessMode === "cloudflare-tunnel" || Boolean(config.cloudflareTunnelEnabled)
  if (!tunnelMode) return false

  return config.cloudflareTunnelAutoStart !== false
}

/** Save tunnel URL for mobile discover + desktop Domain; notify paired phones. */
export async function persistTunnelPublicUrl(
  fastify: FastifyInstance,
  publicUrl: string,
): Promise<void> {
  const instance = await fastify.prisma.instanceConfig.findFirst()
  if (!instance) return

  const prevConfig = readRemoteAccessConfig(instance.remoteAccessConfig)
  await fastify.prisma.instanceConfig.update({
    where: { id: instance.id },
    data: {
      publicUrl,
      remoteAccessMode: "cloudflare-tunnel",
      remoteAccessConfig: {
        ...prevConfig,
        mobilePublicUrl: publicUrl,
        cloudflareTunnelEnabled: true,
        cloudflareTunnelAutoStart: prevConfig.cloudflareTunnelAutoStart !== false,
        reverseProxyEnabled: false,
      },
    },
  })

  await broadcastInstanceUrlsUpdated(fastify, instance.id)
  fastify.log.info({ publicUrl }, "Cloudflare tunnel URL saved for mobile and remote access")
}
