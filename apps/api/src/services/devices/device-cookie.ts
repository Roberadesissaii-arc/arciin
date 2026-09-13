import { TRUSTED_DEVICE_COOKIE_NAME } from "@arciin/config"
import type { FastifyReply, FastifyRequest } from "fastify"

import { isSecureCookie } from "@/services/security/auth"

export function extractDeviceAuthorization(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = header.match(/^Device\s+(.+)$/i)
  const value = match?.[1]?.trim()
  return value || null
}

export function setTrustedDeviceCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  request?: FastifyRequest,
) {
  reply.setCookie(TRUSTED_DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(request),
    expires: expiresAt,
  })
}

export function clearTrustedDeviceCookie(reply: FastifyReply, request?: FastifyRequest) {
  reply.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(request),
  })
}

export function readTrustedDeviceCookie(request: FastifyRequest): string | null {
  const value = request.cookies[TRUSTED_DEVICE_COOKIE_NAME]?.trim()
  return value || null
}
