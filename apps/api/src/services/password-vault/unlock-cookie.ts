import { createHmac, timingSafeEqual } from "node:crypto"

import type { FastifyReply, FastifyRequest } from "fastify"

import { apiConfig } from "@/config"
import { isSecureCookie } from "@/services/security/auth"

export const VAULT_UNLOCK_COOKIE = "arciin_vault_unlock"
export const VAULT_UNLOCK_TTL_MS = 15 * 60 * 1000

export function vaultUnlockExpiresAt(from = Date.now()) {
  return new Date(from + VAULT_UNLOCK_TTL_MS)
}

export function isVaultUnlockSessionValid(
  session: { userId: string; vaultUnlockedUntil: Date | null } | null | undefined,
  userId: string,
): boolean {
  if (!session || session.userId !== userId) return false
  if (!session.vaultUnlockedUntil) return false
  return session.vaultUnlockedUntil.getTime() > Date.now()
}

function sign(payload: string): string {
  return createHmac("sha256", apiConfig.SESSION_SECRET).update(payload).digest("base64url")
}

export function issueVaultUnlockCookie(reply: FastifyReply, userId: string) {
  const exp = Date.now() + VAULT_UNLOCK_TTL_MS
  const body = `${userId}.${exp}`
  const token = `${body}.${sign(body)}`
  reply.setCookie(VAULT_UNLOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(),
    maxAge: Math.floor(VAULT_UNLOCK_TTL_MS / 1000),
  })
}

export function clearVaultUnlockCookie(reply: FastifyReply) {
  reply.clearCookie(VAULT_UNLOCK_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(),
  })
}

export function isVaultUnlockCookieValid(request: FastifyRequest, userId: string): boolean {
  const token = request.cookies[VAULT_UNLOCK_COOKIE]
  if (!token) return false

  const parts = token.split(".")
  if (parts.length !== 3) return false

  const [uid, expStr, sig] = parts
  if (uid !== userId) return false

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now()) return false

  const body = `${uid}.${expStr}`
  const expected = sign(body)

  try {
    const a = Buffer.from(sig ?? "")
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Cookie (browser) or session row (mobile Bearer). */
export function isVaultUnlockValid(
  request: FastifyRequest,
  userId: string,
  session?: { userId: string; vaultUnlockedUntil: Date | null } | null,
): boolean {
  if (isVaultUnlockCookieValid(request, userId)) return true
  return isVaultUnlockSessionValid(session, userId)
}
