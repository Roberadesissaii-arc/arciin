import type { FastifyReply, FastifyRequest } from "fastify"
import type { User } from "@prisma/client"

import { decryptSecret } from "@/services/security/encryption"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import {
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from "@/services/security/mfa"
import { recordSecurityEvent } from "@/services/security/security-events"

export type SecondFactorOutcome = "accepted" | "rejected" | "challenge-issued"

/**
 * Check the second factor during sign-in, and answer the caller if it fails.
 *
 * Returns "accepted" only when a code was supplied and proved out. Every other
 * path has already written a reply, so the caller returns without creating a
 * session.
 *
 * A recovery code is spent the moment it is accepted. It is marked used in the
 * same conditional update that selects it, so two requests racing with the
 * same code cannot both win.
 */
export async function consumeSecondFactor(
  request: FastifyRequest,
  reply: FastifyReply,
  user: User,
  submitted: { totp?: string; recoveryCode?: string },
): Promise<SecondFactorOutcome> {
  const fastify = request.server

  const hasTotp = Boolean(submitted.totp?.trim())
  const hasRecovery = Boolean(submitted.recoveryCode?.trim())

  if (!hasTotp && !hasRecovery) {
    // Not an error: the client now knows to collect a code. No session, no
    // cookie, and nothing said about the account beyond "this step exists".
    reply.status(200).send({ data: { mfaRequired: true } })
    return "challenge-issued"
  }

  // Guessing six digits is cheap without a ceiling on attempts.
  if (
    await checkEndpointRateLimit(request, reply, { key: "mfa", limit: 10, windowSec: 300 })
  ) {
    return "rejected"
  }

  if (hasRecovery) {
    const codeHash = hashRecoveryCode(submitted.recoveryCode!)
    if (normalizeRecoveryCode(submitted.recoveryCode!).length === 0) {
      return deny(reply)
    }
    // Conditional on usedAt being null, so a replay updates nothing.
    const spent = await fastify.prisma.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (spent.count !== 1) return deny(reply)

    const remaining = await fastify.prisma.mfaRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    })
    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.mfa_recovery_used",
      title: "Recovery code used",
      message: `A single-use recovery code was accepted. ${remaining} remaining.`,
      metadata: { status: "ok" },
    })
    return "accepted"
  }

  if (!user.mfaSecretEnc) return deny(reply)

  const result = verifyTotp({
    token: submitted.totp!,
    secret: decryptSecret(user.mfaSecretEnc),
    lastUsedStep: user.mfaLastUsedStep === null ? null : Number(user.mfaLastUsedStep),
  })
  if (!result.ok) return deny(reply)

  // Remember the step so the same six digits cannot be presented twice.
  await fastify.prisma.user.update({
    where: { id: user.id },
    data: { mfaLastUsedStep: BigInt(result.step) },
  })
  return "accepted"
}

function deny(reply: FastifyReply): SecondFactorOutcome {
  // One message for a wrong code, a spent recovery code and a replayed one:
  // which of those it was is information the sender has not earned.
  reply.status(401).send({
    error: { code: "MFA_INVALID", message: "That code is not valid." },
  })
  return "rejected"
}
