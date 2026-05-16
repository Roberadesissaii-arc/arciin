import { createHmac, timingSafeEqual } from "node:crypto"

import type { FastifyReply, FastifyRequest } from "fastify"

import { apiConfig } from "@/config"
import { isSecureCookie } from "@/services/security/auth"

export const VAULT_UNLOCK_COOKIE = "arciin_vault_unlock"
const UNLOCK_TTL_MS = 15 * 60 * 1000

function sign(payload: string): string {
  return createHmac("sha256", apiConfig.SESSION_SECRET).update(payload).digest("base64url")
}

export function issueVaultUnlockCookie(reply: FastifyReply, userId: string) {
  const exp = Date.now() + UNLOCK_TTL_MS
  const body = `${userId}.${exp}`
  const token = `${body}.${sign(body)}`
  reply.setCookie(VAULT_UNLOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(),
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  })
}

export function clearVaultUnlockCookie(reply: FastifyReply) {
  reply.clearCookie(VAULT_UNLOCK_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(),
  })
}

export function isVaultUnlockValid(request: FastifyRequest, userId: string): boolean {
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
