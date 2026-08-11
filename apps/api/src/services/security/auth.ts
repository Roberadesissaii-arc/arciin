import { createHash, randomBytes } from "node:crypto"

import { hash, verify } from "@node-rs/argon2"
import type { FastifyReply, FastifyRequest } from "fastify"

import { apiConfig } from "@/config"
import { verifyMediaToken } from "@/services/security/media-token"
import { clientIpFromRequest, normalizeClientIp } from "@/services/security/client-ip"
import { enforceApiKeyRateLimit } from "@/services/security/api-key-rate-limit"

export async function hashPassword(password: string) {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })
}

export async function verifyPassword(password: string, passwordHash: string) {
  return verify(passwordHash, password)
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function hashApiKey(rawKey: string) {
  return createHash("sha256").update(rawKey).digest("hex")
}

/** API keys: `admin` or `appdata:admin` satisfy any app-data scope check. */
export function scopeAllows(scopes: string[] | null | undefined, required: string) {
  if (!scopes?.length) {
    return false
  }
  if (scopes.includes("admin") || scopes.includes("appdata:admin")) {
    return true
  }
  return scopes.includes(required)
}

export function scopeAllowsAny(scopes: string[] | null | undefined, required: string[]) {
  return required.some((r) => scopeAllows(scopes, r))
}

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("hex")
}

export function isSecureCookie(request?: FastifyRequest) {
  // Self-hosted HTTP on LAN must not use Secure cookies (browsers drop them).
  if (apiConfig.ARCIIN_PUBLIC_URL.startsWith("https://")) {
    return true
  }

  const forwarded = request?.headers["x-forwarded-proto"]
  if (typeof forwarded === "string" && forwarded.split(",")[0]?.trim() === "https") {
    return true
  }

  return false
}

export async function createSession(
  request: FastifyRequest,
  userId: string,
  options?: {
    expiresInDays?: number
    /** Session lifetime from now (overrides expiresInDays when set). */
    expiresInMinutes?: number
  }
) {
  const rawToken = generateOpaqueToken()
  const expiresAt = new Date()
  if (options?.expiresInMinutes != null && options.expiresInMinutes > 0) {
    expiresAt.setMinutes(expiresAt.getMinutes() + options.expiresInMinutes)
  } else {
    expiresAt.setDate(expiresAt.getDate() + (options?.expiresInDays ?? 30))
  }

  const userAgent = request.headers["user-agent"] ?? null
  const ipAddress = normalizeClientIp(clientIpFromRequest(request))

  const session = await request.server.prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      userAgent,
      ipAddress,
      expiresAt,
    },
  })

  /**
   * Signing in again from a device that already has a session replaces it
   * rather than stacking another row. Re-authenticating had been appending
   * one entry per sign-in, so Settings -> Sessions listed the same phone six
   * times and there was no way to tell which row to revoke — or whether
   * revoking one of them did anything.
   *
   * Only exact (user, user-agent, ip) matches collapse, and the new session is
   * created first so a failure here can never sign anyone out. Sessions with no
   * user-agent are left alone: too weak a signal to treat as the same device.
   */
  if (userAgent && ipAddress) {
    await request.server.prisma.session
      .deleteMany({
        where: {
          userId,
          userAgent,
          ipAddress,
          id: { not: session.id },
        },
      })
      .catch(() => {})
  }

  return {
    session,
    rawToken,
  }
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  request?: FastifyRequest,
  options?: {
    /** false → browser-session cookie (no expires); forgotten when the browser closes. */
    persistent?: boolean
  },
) {
  const persistent = options?.persistent ?? true
  reply.setCookie(apiConfig.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(request),
    ...(persistent ? { expires: expiresAt } : {}),
  })
}

export function clearSessionCookie(reply: FastifyReply, request?: FastifyRequest) {
  reply.clearCookie(apiConfig.SESSION_COOKIE_NAME, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(request),
  })
}

export async function resolveSession(request: FastifyRequest) {
  const token = request.cookies[apiConfig.SESSION_COOKIE_NAME]

  if (!token) {
    return null
  }

  const session = await request.server.prisma.session.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    include: {
      user: true,
    },
  })

  if (!session || session.expiresAt < new Date() || session.user.status !== "ACTIVE") {
    return null
  }

  return session
}

/** Session token from `Authorization: Bearer` or `?access_token=` (media `<audio>` / `<video>` cannot send headers). */
export function extractMobileSessionToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token && !token.startsWith("arc_")) return token
  }

  const query = request.query as { access_token?: string }
  const fromQuery =
    typeof query.access_token === "string" ? query.access_token.trim() : ""
  if (fromQuery && !fromQuery.startsWith("arc_")) return fromQuery

  return null
}

/** Mobile PWA / API clients: `Authorization: Bearer <session_token>` (not API keys). */
async function resolveBearerSession(request: FastifyRequest) {
  const token = extractMobileSessionToken(request)
  if (!token) {
    return null
  }

  const session = await request.server.prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })

  if (!session || session.expiresAt < new Date() || session.user.status !== "ACTIVE") {
    return null
  }

  return session
}

/** Cookie session, or Bearer session token (mobile). */
export async function resolveSessionFromRequest(request: FastifyRequest) {
  return (await resolveSession(request)) ?? (await resolveBearerSession(request))
}

async function refreshSessionIp(request: FastifyRequest, sessionId: string) {
  const ip = normalizeClientIp(clientIpFromRequest(request))
  if (!ip) return
  await request.server.prisma.session
    .updateMany({
      where: { id: sessionId, OR: [{ ipAddress: null }, { ipAddress: { not: ip } }] },
      data: { ipAddress: ip },
    })
    .catch(() => {})
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const session = await resolveSessionFromRequest(request)

  if (!session) {
    reply.status(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to access this resource.",
      },
    })
    return
  }

  request.auth = {
    user: session.user,
    session,
    apiKeyId: null,
    apiKeyScopes: null,
  }
  void refreshSessionIp(request, session.id)
}

/** Cookie session first, else `Authorization: Bearer arc_…` API key. */
export async function authenticateFlexible(request: FastifyRequest, reply: FastifyReply) {
  const session = await resolveSessionFromRequest(request)

  if (session) {
    request.auth = {
      user: session.user,
      session,
      apiKeyId: null,
      apiKeyScopes: null,
    }
    void refreshSessionIp(request, session.id)
    return
  }

  const authHeader = request.headers.authorization
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    reply.status(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in or provide Authorization: Bearer <api_key>.",
      },
    })
    return
  }

  const token = authHeader.slice(7).trim()

  if (!token.startsWith("arc_")) {
    reply.status(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "Invalid or expired session token.",
      },
    })
    return
  }

  const row = await request.server.prisma.apiKey.findFirst({
    where: {
      keyHash: hashApiKey(token),
      revokedAt: null,
    },
    include: {
      user: true,
    },
  })

  if (!row || row.user.status !== "ACTIVE") {
    reply.status(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "Invalid or revoked API key.",
      },
    })
    return
  }

  if (row.expiresAt && row.expiresAt < new Date()) {
    reply.status(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "API key has expired.",
      },
    })
    return
  }

  await request.server.prisma.apiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  })

  request.auth = {
    user: row.user,
    session: null,
    apiKeyId: row.id,
    apiKeyScopes: row.scopes,
  }

  const allowed = await enforceApiKeyRateLimit(request, reply)
  if (!allowed) {
    request.auth = undefined
    return
  }
}

export function requireSessionRolesOrApiKeyScopes(
  sessionRoles: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">,
  apiKeyScopesAnyOf: string[]
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticateFlexible(request, reply)

    if (!request.auth) {
      return
    }

    if (request.auth.session) {
      if (!sessionRoles.includes(request.auth.user.role)) {
        reply.status(403).send({
          error: {
            code: "FORBIDDEN",
            message: "You do not have access to this resource.",
          },
        })
        return
      }
      return
    }

    if (!scopeAllowsAny(request.auth.apiKeyScopes, apiKeyScopesAnyOf)) {
      reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "This API key is missing a required scope.",
        },
      })
      return
    }
  }
}

/**
 * Media routes: a normal session / API key, or a short-lived token scoped to
 * this one asset.
 *
 * `<video>` and `<img>` cannot send an Authorization header, so the credential
 * has to be in the query string. Accepting a *session* token there — which the
 * app does today via `?access_token=` — means a leaked media URL is a full
 * credential, usable against every authenticated route. A media token is bound
 * to one asset id and expires in minutes, so the same leak costs one file for
 * a short window.
 *
 * The legacy `?access_token=` path still works; removing it breaks every
 * already-installed PWA, so that is a separate, later change.
 */
export function requireAssetMediaAccess(
  sessionRoles: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">,
  apiKeyScopesAnyOf: string[],
) {
  const fallback = requireSessionRolesOrApiKeyScopes(sessionRoles, apiKeyScopesAnyOf)

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { media_token?: string }
    const token = typeof query?.media_token === "string" ? query.media_token.trim() : ""
    const params = request.params as { assetId?: string }
    const assetId = typeof params?.assetId === "string" ? params.assetId : ""

    if (token && assetId) {
      const result = verifyMediaToken({ token, assetId })
      if (result.ok) {
        const user = await request.server.prisma.user.findUnique({
          where: { id: result.userId },
        })
        if (user && user.status === "ACTIVE" && sessionRoles.includes(user.role)) {
          request.auth = { user, session: null, apiKeyId: null, apiKeyScopes: null }
          return
        }
      }
      reply.status(401).send({
        error: { code: "INVALID_MEDIA_TOKEN", message: "This media link has expired." },
      })
      return
    }

    await fallback(request, reply)
  }
}

export function requireRole(roles: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticateFlexible(request, reply)

    if (!request.auth) {
      return
    }

    if (!roles.includes(request.auth.user.role)) {
      reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "You do not have access to this resource.",
        },
      })
    }
  }

  return handler
}

/**
 * Enforce plan entitlements on the API (never rely on UI alone).
 * Free-core routes (files, libraries, uploads) must NOT use this for basic access.
 */
export function requireFeature(feature: import("@arciin/shared").LicenseFeatureId) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent) return

    // Lazy import avoids circular deps with license-service → config.
    const [{ hasFeature, plansWithFeature }, licenseService] = await Promise.all([
      import("@arciin/shared"),
      import("@/services/license/license-service"),
    ])

    let snapshot = await licenseService.loadLicenseSnapshot(request.server.prisma)
    snapshot = await licenseService.syncLicenseStatusIfNeeded(request.server.prisma, snapshot)

    if (hasFeature(snapshot, feature)) {
      return
    }

    const needed = plansWithFeature(feature)
    reply.status(403).send({
      error: {
        code: "LICENSE_REQUIRED",
        message: `This feature requires a higher Arciin plan (${needed.join(", ")}). Free core still keeps your files accessible.`,
        details: {
          feature,
          plan: snapshot.plan,
          status: snapshot.status,
          requiredPlans: needed,
        },
      },
    })
  }

  return handler
}
