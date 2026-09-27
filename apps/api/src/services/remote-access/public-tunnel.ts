import type { PrismaClient } from "@prisma/client"

import { hasFeature, plansWithFeature, type LicensePlanId } from "@arciin/shared"

import { loadLicenseSnapshot, syncLicenseStatusIfNeeded } from "@/services/license/license-service"
import { startCloudflareQuickTunnel } from "@/services/remote-access/cloudflare-tunnel"
import { canEnablePublicRemoteAccess } from "@/services/security/owner-mfa-policy"

/**
 * The only way Arciin puts itself on the public internet.
 *
 * Every path that can open a Cloudflare tunnel — the Start button, the mobile
 * Start button, enabling the tunnel in Remote Access settings, the boot-time
 * auto-start, and the restart after cloudflared exits — goes through
 * startPublicTunnel, and startPublicTunnel checks the policy before anything is
 * spawned. `/start-mobile` once skipped the check that `/start` had; a single
 * choke point is what stops the next route doing the same.
 * tests/public-tunnel-choke-point.test.ts fails if anything else imports the
 * raw spawner.
 *
 * The policy has two parts, checked in this order:
 *
 * 1. The plan. Public Remote Access is `ops.remote_access_helper` — Pro, Team
 *    and Business. Only the Start routes used to check it, so the boot
 *    auto-start happily opened a tunnel on a Free instance whose Generate URL
 *    button answered "requires a higher plan". The answer comes from the
 *    current license snapshot, never from a saved public URL, a setting, or a
 *    tunnel that happens to be running.
 * 2. The owner's second factor.
 *
 * Mobile tunnels are public Remote Access: whether the public hostname ends up
 * serving the desktop app or the phone app does not change who can reach the
 * sign-in page.
 *
 * LAN use is untouched. This runs when the door to the internet is opened,
 * never on sign-in, so a Free owner — or an upgraded owner without MFA — keeps
 * full use of the server at home.
 */

export const PUBLIC_REMOTE_ACCESS_FEATURE = "ops.remote_access_helper" as const

export type RemoteAccessEntitlement = {
  entitled: boolean
  plan: LicensePlanId
  status: string
  requiredPlans: LicensePlanId[]
}

/** Whether the current license includes public Remote Access. */
export async function readRemoteAccessEntitlement(prisma: PrismaClient): Promise<RemoteAccessEntitlement> {
  let snapshot = await loadLicenseSnapshot(prisma)
  snapshot = await syncLicenseStatusIfNeeded(prisma, snapshot)
  return {
    entitled: hasFeature(snapshot, PUBLIC_REMOTE_ACCESS_FEATURE),
    plan: snapshot.plan,
    status: snapshot.status,
    requiredPlans: plansWithFeature(PUBLIC_REMOTE_ACCESS_FEATURE),
  }
}

export type PublicRemoteAccessDenial = "LICENSE_REQUIRED" | "OWNER_MFA_REQUIRED"

export type PublicRemoteAccessPolicy =
  | { allowed: true; entitlement: RemoteAccessEntitlement }
  | { allowed: false; code: PublicRemoteAccessDenial; message: string; entitlement: RemoteAccessEntitlement }

/** Plan first, then the owner's second factor. The one answer every path uses. */
export async function evaluatePublicRemoteAccess(prisma: PrismaClient): Promise<PublicRemoteAccessPolicy> {
  const entitlement = await readRemoteAccessEntitlement(prisma)
  if (!entitlement.entitled) {
    return {
      allowed: false,
      code: "LICENSE_REQUIRED",
      message:
        `Public Remote Access is available with ${entitlement.requiredPlans.map(planName).join(", ")}. ` +
        "Free core keeps your files reachable on your own network.",
      entitlement,
    }
  }
  const mfa = await canEnablePublicRemoteAccess(prisma)
  if (!mfa.allowed) return { allowed: false, code: mfa.code, message: mfa.message, entitlement }
  return { allowed: true, entitlement }
}

function planName(plan: LicensePlanId) {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export class PublicRemoteAccessDeniedError extends Error {
  constructor(
    readonly code: PublicRemoteAccessDenial,
    message: string,
  ) {
    super(message)
    this.name = "PublicRemoteAccessDeniedError"
  }
}

/** Throws PublicRemoteAccessDeniedError unless public Remote Access may be opened. */
export async function assertPublicRemoteAccessAllowed(prisma: PrismaClient): Promise<void> {
  const verdict = await evaluatePublicRemoteAccess(prisma)
  if (!verdict.allowed) throw new PublicRemoteAccessDeniedError(verdict.code, verdict.message)
}

/** Policy first, then spawn. Nothing is started and no hostname exists if the policy refuses. */
export async function startPublicTunnel(
  prisma: PrismaClient,
  localTarget: string,
  options: { force?: boolean } = {},
): Promise<string> {
  await assertPublicRemoteAccessAllowed(prisma)
  return startCloudflareQuickTunnel(localTarget, options)
}

/** Fastify preHandler: answers 403 LICENSE_REQUIRED / OWNER_MFA_REQUIRED before a route does anything. */
export async function requirePublicRemoteAccessPolicy(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) {
  if (reply.sent) return
  try {
    await assertPublicRemoteAccessAllowed(request.server.prisma)
  } catch (error) {
    if (error instanceof PublicRemoteAccessDeniedError) {
      reply.status(403).send({ error: { code: error.code, message: error.message } })
      return reply
    }
    throw error
  }
}
