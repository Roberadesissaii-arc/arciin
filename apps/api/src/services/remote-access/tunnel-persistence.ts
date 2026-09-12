import type { FastifyInstance } from "fastify"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { announcePublicUrlChange } from "@/services/email/notify-public-url"
import { broadcastInstanceUrlsUpdated } from "@/services/mobile/mobile-server-urls"
import { formatAdvertisedHttpOrigin } from "@arciin/config"

import { getCloudflareTunnelState } from "@/services/remote-access/cloudflare-tunnel"
import { resolveMobileWebPort, resolveWebPort } from "@/services/remote-access/local-access-urls"

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

/**
 * True only for a tunnel pointed straight at the mobile PWA port.
 *
 * Kept for the legacy case where someone has set ARCIIN_MOBILE_TUNNEL_TARGET
 * by hand. The normal path now tunnels the desktop origin, which serves both
 * apps via `apps/web/proxy.ts`, so both URL fields describe the same domain.
 */
function isMobileTunnelTarget(localTarget: string | null | undefined): boolean {
  if (!localTarget?.trim()) return false
  try {
    const mobileLoopback = formatAdvertisedHttpOrigin("127.0.0.1", resolveMobileWebPort())
    const desktopLoopback = formatAdvertisedHttpOrigin("127.0.0.1", resolveWebPort())
    const normalized = localTarget.replace(/\/+$/, "")
    // When both apps share a port there is no "mobile-only" tunnel to speak of.
    if (mobileLoopback === desktopLoopback) return false
    return normalized === mobileLoopback
  } catch {
    return false
  }
}

/** Save tunnel URL for mobile discover + desktop Domain; notify paired phones. */
export async function persistTunnelPublicUrl(
  fastify: FastifyInstance,
  publicUrl: string,
): Promise<void> {
  const instance = await fastify.prisma.instanceConfig.findFirst()
  if (!instance) return

  const localTarget = getCloudflareTunnelState().localTarget
  const mobileOnly = isMobileTunnelTarget(localTarget)

  const prevConfig = readRemoteAccessConfig(instance.remoteAccessConfig)
  const previousPublicUrl =
    (typeof prevConfig.mobilePublicUrl === "string" ? prevConfig.mobilePublicUrl : null) ??
    (instance.publicUrl ? instance.publicUrl : null)
  const normalizedPrevious = previousPublicUrl?.replace(/\/+$/, "") ?? null
  const normalizedNew = publicUrl.replace(/\/+$/, "")
  const urlChanged = Boolean(normalizedPrevious && normalizedPrevious !== normalizedNew)

  await fastify.prisma.instanceConfig.update({
    where: { id: instance.id },
    data: mobileOnly
      ? {
          remoteAccessMode: "cloudflare-tunnel",
          remoteAccessConfig: {
            ...prevConfig,
            mobilePublicUrl: publicUrl,
            cloudflareTunnelEnabled: true,
            cloudflareTunnelAutoStart: prevConfig.cloudflareTunnelAutoStart !== false,
            reverseProxyEnabled: false,
          },
        }
      : {
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

  if (urlChanged) {
    const previousHost = (() => {
      try {
        return new URL(normalizedPrevious!).hostname
      } catch {
        return normalizedPrevious
      }
    })()
    const newHost = (() => {
      try {
        return new URL(normalizedNew).hostname
      } catch {
        return normalizedNew
      }
    })()

    await recordAndBroadcastActivity(fastify, {
      type: "remote.public_url_changed",
      title: "Public URL changed",
      message: `Cloudflare quick tunnel restarted (${previousHost} → ${newHost}). Paired phones reconnect on Wi‑Fi; away from home, open the app to refresh.`,
      entityType: "remote",
      metadata: {
        previousPublicUrl: normalizedPrevious,
        publicUrl: normalizedNew,
      },
    })

    // The whole point of the email: this restart usually happens unattended,
    // and the person who needs the new address is the one who is not at the
    // server. Never let a mail failure take down tunnel persistence with it.
    void announcePublicUrlChange(fastify, {
      publicUrl: normalizedNew,
      previousPublicUrl: normalizedPrevious,
    })
      .then((sent) => {
        fastify.log.info(sent, "Announced new public URL")
      })
      .catch((error) => {
        fastify.log.warn({ err: error }, "Public URL announcement failed")
      })
  }

  await broadcastInstanceUrlsUpdated(fastify, instance.id, {
    previousPublicUrl: urlChanged ? normalizedPrevious : null,
  })
  fastify.log.info({ publicUrl }, "Cloudflare tunnel URL saved for mobile and remote access")
}
