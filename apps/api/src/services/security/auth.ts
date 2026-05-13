import { createHash, randomBytes } from "node:crypto"

import { hash, verify } from "@node-rs/argon2"
import type { FastifyReply, FastifyRequest } from "fastify"

import { apiConfig } from "@/config"

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

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("hex")
}

export function isSecureCookie() {
  return apiConfig.isProduction || apiConfig.ARCIIN_PUBLIC_URL.startsWith("https://")
}

export async function createSession(
  request: FastifyRequest,
  userId: string,
  options?: {
    expiresInDays?: number
  }
) {
  const rawToken = generateOpaqueToken()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + (options?.expiresInDays ?? 30))

  const session = await request.server.prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
      expiresAt,
    },
  })

  return {
    session,
    rawToken,
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(apiConfig.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(),
    expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(apiConfig.SESSION_COOKIE_NAME, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(),
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

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const session = await resolveSession(request)

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
  }
}

export function requireRole(roles: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply)

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
