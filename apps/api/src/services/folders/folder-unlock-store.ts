import { createHmac, timingSafeEqual } from "node:crypto"

import type { FastifyReply, FastifyRequest } from "fastify"

import { apiConfig } from "@/config"
import { isSecureCookie } from "@/services/security/auth"

export const FOLDER_UNLOCK_COOKIE = "arciin_folder_unlocks"
export const FOLDER_UNLOCK_TTL_MS = 15 * 60 * 1000

type UnlockMap = Record<string, number>

function sign(payload: string): string {
  return createHmac("sha256", apiConfig.SESSION_SECRET).update(payload).digest("base64url")
}

function parseUnlockMap(raw: unknown): UnlockMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: UnlockMap = {}
  for (const [folderId, exp] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof exp === "string") {
      const ms = Date.parse(exp)
      if (Number.isFinite(ms) && ms > Date.now()) out[folderId] = ms
    } else if (typeof exp === "number" && exp > Date.now()) {
      out[folderId] = exp
    }
  }
  return out
}

export function readSessionFolderUnlocks(
  session: { folderUnlocks?: unknown } | null | undefined,
): UnlockMap {
  return parseUnlockMap(session?.folderUnlocks)
}

export function sessionFolderUnlocksToJson(map: UnlockMap): Record<string, string> {
  const out: Record<string, string> = {}
  const now = Date.now()
  for (const [id, exp] of Object.entries(map)) {
    if (exp > now) out[id] = new Date(exp).toISOString()
  }
  return out
}

function readCookieUnlockMap(request: FastifyRequest, userId: string): UnlockMap {
  const token = request.cookies[FOLDER_UNLOCK_COOKIE]
  if (!token) return {}

  const parts = token.split(".")
  if (parts.length !== 3) return {}

  const [uid, payloadB64, sig] = parts
  if (uid !== userId) return {}

  const body = `${uid}.${payloadB64}`
  const expected = sign(body)
  try {
    const a = Buffer.from(sig ?? "")
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return {}
  } catch {
    return {}
  }

  try {
    const json = Buffer.from(payloadB64 ?? "", "base64url").toString("utf8")
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: UnlockMap = {}
    const now = Date.now()
    for (const [folderId, exp] of Object.entries(parsed as Record<string, number>)) {
      if (typeof exp === "number" && exp > now) out[folderId] = exp
    }
    return out
  } catch {
    return {}
  }
}

export function isFolderAccessGranted(
  request: FastifyRequest,
  userId: string,
  folderId: string,
  session?: { userId: string; folderUnlocks?: unknown } | null,
): boolean {
  const cookieMap = readCookieUnlockMap(request, userId)
  if (cookieMap[folderId]) return true

  if (session && session.userId === userId) {
    const sessionMap = readSessionFolderUnlocks(session)
    if (sessionMap[folderId]) return true
  }

  return false
}

export function issueFolderUnlock(
  reply: FastifyReply,
  request: FastifyRequest,
  userId: string,
  folderId: string,
): UnlockMap {
  const merged = {
    ...readCookieUnlockMap(request, userId),
    [folderId]: Date.now() + FOLDER_UNLOCK_TTL_MS,
  }
  const pruned: UnlockMap = {}
  const now = Date.now()
  for (const [id, exp] of Object.entries(merged)) {
    if (exp > now) pruned[id] = exp
  }

  const payloadB64 = Buffer.from(JSON.stringify(pruned), "utf8").toString("base64url")
  const body = `${userId}.${payloadB64}`
  const token = `${body}.${sign(body)}`
  reply.setCookie(FOLDER_UNLOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(),
    maxAge: Math.floor(FOLDER_UNLOCK_TTL_MS / 1000),
  })

  return pruned
}
