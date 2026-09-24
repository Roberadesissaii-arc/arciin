import type { PrismaClient } from "@prisma/client"

import { startCloudflareQuickTunnel } from "@/services/remote-access/cloudflare-tunnel"
import { canEnablePublicRemoteAccess } from "@/services/security/owner-mfa-policy"

/**
 * The only way Arciin puts itself on the public internet.
 *
 * Every path that can open a Cloudflare tunnel — the Start button, the mobile
 * Start button, enabling the tunnel in Remote Access settings, the boot-time
 * auto-start, and the restart after cloudflared exits — goes through
 * startPublicTunnel, and startPublicTunnel checks the owner-MFA policy before
 * anything is spawned. `/start-mobile` once skipped the check that `/start`
 * had; a single choke point is what stops the next route doing the same.
 * tests/public-tunnel-choke-point.test.ts fails if anything else imports the
 * raw spawner.
 *
 * Mobile tunnels are public Remote Access: whether the public hostname ends up
 * serving the desktop app or the phone app does not change who can reach the
 * sign-in page.
 *
 * LAN use is untouched. This runs when the door to the internet is opened,
 * never on sign-in, so an upgraded owner without MFA keeps full use of the
 * server at home.
 */

export class PublicRemoteAccessDeniedError extends Error {
  readonly code = "OWNER_MFA_REQUIRED" as const
  constructor(message: string) {
    super(message)
    this.name = "PublicRemoteAccessDeniedError"
  }
}

/** Throws PublicRemoteAccessDeniedError unless public Remote Access may be opened. */
export async function assertOwnerMfaForPublicRemoteAccess(prisma: PrismaClient): Promise<void> {
  const verdict = await canEnablePublicRemoteAccess(prisma)
  if (!verdict.allowed) throw new PublicRemoteAccessDeniedError(verdict.message)
}

/** Policy first, then spawn. Nothing is started and no hostname exists if the policy refuses. */
export async function startPublicTunnel(
  prisma: PrismaClient,
  localTarget: string,
  options: { force?: boolean } = {},
): Promise<string> {
  await assertOwnerMfaForPublicRemoteAccess(prisma)
  return startCloudflareQuickTunnel(localTarget, options)
}

/** Fastify preHandler: answers 403 OWNER_MFA_REQUIRED before a route does anything. */
export async function requireOwnerMfaForPublicRemoteAccess(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) {
  if (reply.sent) return
  try {
    await assertOwnerMfaForPublicRemoteAccess(request.server.prisma)
  } catch (error) {
    if (error instanceof PublicRemoteAccessDeniedError) {
      reply.status(403).send({ error: { code: error.code, message: error.message } })
      return reply
    }
    throw error
  }
}
