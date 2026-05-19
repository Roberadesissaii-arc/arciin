import {
  ACCENT_COLORS,
  FONT_SIZE_OPTIONS,
  TOAST_POSITIONS,
  TOAST_STYLES,
  UI_RADIUS_OPTIONS,
  mergeUserPreferences,
  parseUserPreferences,
  type UserPreferences,
} from "@arciin/shared"
import { createReadStream } from "node:fs"
import { access } from "node:fs/promises"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { apiConfig } from "@/config"
import { serializeAuth, serializeSession, serializeUser } from "@/services/serializers"
import { loadAccessControlSettings } from "@/services/security/access-control-settings"
import { clientIpFromRequest, normalizeClientIp } from "@/services/security/client-ip"
import { recordSecurityEvent } from "@/services/security/security-events"
import {
  authenticate,
  authenticateFlexible,
  clearSessionCookie,
  createSession,
  hashPassword,
  hashToken,
  setSessionCookie,
  verifyPassword,
} from "@/services/security/auth"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import {
  clearFailedLoginAttempts,
  isLoginLocked,
  recordFailedLogin,
} from "@/services/security/login-guard"
import {
  extensionFromMime,
  removeUserAvatarFiles,
  resolveAvatarAbsolutePath,
  saveUserAvatar,
} from "@/services/user/avatar"

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  password: z.string().min(8),
})

const accentValues = ACCENT_COLORS.map((c) => c.hex) as [string, ...string[]]

const userPreferencesPatchSchema = z
  .object({
    notifications: z
      .object({
        uploadSound: z.boolean().optional(),
        uploadCompleteToast: z.boolean().optional(),
        uploadFailedToast: z.boolean().optional(),
        activityFeedToast: z.boolean().optional(),
        securityEventsToast: z.boolean().optional(),
      })
      .optional(),
    appearance: z
      .object({
        compactView: z.boolean().optional(),
        animatedCards: z.boolean().optional(),
        accentColor: z.enum(accentValues).optional(),
        toastPosition: z.enum(TOAST_POSITIONS).optional(),
        toastStyle: z.enum(TOAST_STYLES).optional(),
        toastShowIcons: z.boolean().optional(),
        uiRadius: z.enum(UI_RADIUS_OPTIONS).optional(),
      })
      .optional(),
    accessibility: z
      .object({
        fontSize: z.enum(FONT_SIZE_OPTIONS).optional(),
        reduceAnimations: z.boolean().optional(),
        highContrast: z.boolean().optional(),
        keyboardNav: z.boolean().optional(),
      })
      .optional(),
  })
  .strict()

async function loadUserPreferences(
  prisma: FastifyInstance["prisma"],
  userId: string,
): Promise<UserPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  })
  return parseUserPreferences(user?.preferences ?? null)
}

export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/auth/me",
    {
      preHandler: authenticateFlexible,
    },
    async (request, reply) => {
      if (!request.auth) {
        return
      }

      reply.send({
        data: {
          user: serializeUser(request.auth.user),
          session: request.auth.session ? serializeSession(request.auth.session) : null,
          apiKeyId: request.auth.apiKeyId ?? null,
          apiKeyScopes: request.auth.apiKeyScopes ?? null,
        },
      })
    }
  )

  fastify.post("/auth/register", async (request, reply) => {
    if (await checkEndpointRateLimit(request, reply, { key: "register", limit: 10, windowSec: 60 })) return

    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid registration payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const instance = await fastify.prisma.instanceConfig.findFirst()
    if (!instance) {
      reply.status(409).send({
        error: { code: "INSTANCE_NOT_READY", message: "Complete instance setup before registering." },
      })
      return
    }

    const access = await loadAccessControlSettings(fastify.prisma)
    if (!access.publicSignupEnabled) {
      reply.status(403).send({
        error: {
          code: "SIGNUP_DISABLED",
          message: "Public registration is disabled on this instance.",
        },
      })
      return
    }

    const email = parsed.data.email.toLowerCase()
    const existing = await fastify.prisma.user.findUnique({ where: { email } })
    if (existing) {
      reply.status(409).send({
        error: { code: "EMAIL_IN_USE", message: "An account with this email already exists." },
      })
      return
    }

    const passwordHash = await hashPassword(parsed.data.password)
    const user = await fastify.prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email,
        passwordHash,
        role: "MEMBER",
        status: "ACTIVE",
      },
    })

    const { session, rawToken } = await createSession(request, user.id, {
      expiresInMinutes: access.sessionTimeoutMinutes,
    })
    setSessionCookie(reply, rawToken, session.expiresAt, request)

    await fastify.prisma.activityEvent.create({
      data: {
        userId: user.id,
        type: "auth.register",
        title: "Account created",
        message: `${user.name} registered via public signup.`,
      },
    })

    reply.status(201).send({ data: serializeAuth(user, session) })
  })

  fastify.post("/auth/login", async (request, reply) => {
    if (await checkEndpointRateLimit(request, reply, { key: "login", limit: 20, windowSec: 60 })) return

    const parsed = loginSchema.safeParse(request.body)

    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid login payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const email = parsed.data.email.toLowerCase()
    const lock = await isLoginLocked(fastify, email)
    if (lock.locked) {
      reply.status(429).send({
        error: {
          code: "ACCOUNT_LOCKED",
          message: `Too many failed sign-in attempts. Try again in about 15 minutes.`,
        },
      })
      return
    }

    const user = await fastify.prisma.user.findUnique({
      where: { email },
    })

    if (!user || user.status !== "ACTIVE" || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      await recordFailedLogin(request, reply, email)
      return
    }

    await clearFailedLoginAttempts(fastify, email)

    const access = await loadAccessControlSettings(fastify.prisma)
    const { session, rawToken } = await createSession(request, user.id, {
      expiresInMinutes: access.sessionTimeoutMinutes,
    })
    setSessionCookie(reply, rawToken, session.expiresAt, request)

    const ip = normalizeClientIp(clientIpFromRequest(request)) ?? clientIpFromRequest(request)
    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.login",
      title: "Signed in",
      message: `${user.name} signed in from ${ip}.`,
      metadata: { clientIp: normalizeClientIp(ip) ?? undefined, status: "ok" },
    })

    reply.send({
      data: serializeAuth(user, session),
    })
  })

  const updateProfileSchema = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
    })
    .refine((body) => body.name !== undefined || body.email !== undefined, {
      message: "Provide at least one of name or email.",
    })

  const profileAuth = { preHandler: authenticate }

  async function handleProfileUpdate(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth) return
    const parsed = updateProfileSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid profile payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const { user: authUser, session: authSession } = request.auth
    if (!authSession) {
      reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: "Session required for this action." },
      })
      return
    }
    const nextEmail = parsed.data.email?.toLowerCase()
    if (nextEmail && nextEmail !== authUser.email) {
      const taken = await request.server.prisma.user.findUnique({
        where: { email: nextEmail },
      })
      if (taken) {
        reply.status(409).send({
          error: {
            code: "EMAIL_IN_USE",
            message: "That email address is already in use on this instance.",
          },
        })
        return
      }
    }

    const updated = await request.server.prisma.user.update({
      where: { id: authUser.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(nextEmail !== undefined ? { email: nextEmail } : {}),
      },
    })

    await request.server.prisma.activityEvent.create({
      data: {
        userId: updated.id,
        type: "profile.updated",
        title: "Profile updated",
        message: `${updated.name} updated their profile.`,
      },
    })

    reply.send({
      data: serializeAuth(updated, authSession),
    })
  }

  fastify.patch("/auth/profile", profileAuth, handleProfileUpdate)

  /** POST alias — iOS PWA often fails CORS preflight on PATCH. */
  fastify.post("/auth/profile", profileAuth, handleProfileUpdate)

  fastify.post(
    "/auth/profile/avatar",
    { preHandler: authenticate },
    async (request, reply) => {
      if (!request.auth?.session) {
        reply.status(401).send({
          error: { code: "UNAUTHENTICATED", message: "Session required for this action." },
        })
        return
      }

      const file = await request.file()
      if (!file) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Choose an image file to upload." },
        })
        return
      }

      const buffer = await file.toBuffer()
      const mime = file.mimetype || "application/octet-stream"

      try {
        const relative = await saveUserAvatar(request.auth.user.id, buffer, mime)
        const updated = await fastify.prisma.user.update({
          where: { id: request.auth.user.id },
          data: { avatarPath: relative },
        })
        reply.send({ data: serializeAuth(updated, request.auth.session) })
      } catch (err) {
        reply.status(400).send({
          error: {
            code: "INVALID_AVATAR",
            message: err instanceof Error ? err.message : "Could not save profile image.",
          },
        })
      }
    },
  )

  const removeAvatarAuth = { preHandler: authenticate }

  async function handleRemoveProfileAvatar(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth?.session) {
      reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: "Session required for this action." },
      })
      return
    }

    await removeUserAvatarFiles(request.auth.user.id)
    const updated = await request.server.prisma.user.update({
      where: { id: request.auth.user.id },
      data: { avatarPath: null },
    })
    reply.send({ data: serializeAuth(updated, request.auth.session) })
  }

  fastify.delete("/auth/profile/avatar", removeAvatarAuth, handleRemoveProfileAvatar)

  /** POST alias — iOS PWA often fails CORS preflight on DELETE. */
  fastify.post("/auth/profile/avatar/remove", removeAvatarAuth, handleRemoveProfileAvatar)

  fastify.get(
    "/auth/users/:userId/avatar",
    { preHandler: authenticate },
    async (request, reply) => {
      const { userId } = request.params as { userId: string }
      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { avatarPath: true },
      })
      if (!user?.avatarPath) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "No profile image." },
        })
        return
      }

      const absolute = resolveAvatarAbsolutePath(user.avatarPath)
      if (!absolute) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "No profile image." },
        })
        return
      }

      try {
        await access(absolute)
      } catch {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Profile image file is missing." },
        })
        return
      }

      const ext = extensionFromMime(
        user.avatarPath.endsWith(".png")
          ? "image/png"
          : user.avatarPath.endsWith(".webp")
            ? "image/webp"
            : user.avatarPath.endsWith(".gif")
              ? "image/gif"
              : "image/jpeg",
      )
      reply.header(
        "Content-Type",
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/jpeg",
      )
      reply.header("Cache-Control", "private, max-age=3600")
      return reply.send(createReadStream(absolute))
    },
  )

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })

  const passwordAuth = { preHandler: authenticate }

  async function handlePasswordChange(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth) return
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }
    const user = await request.server.prisma.user.findUnique({
      where: { id: request.auth.user.id },
    })
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      reply.status(400).send({
        error: { code: "INVALID_PASSWORD", message: "Current password is incorrect." },
      })
      return
    }
    const newHash = await hashPassword(parsed.data.newPassword)
    await request.server.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    })
    await request.server.prisma.activityEvent.create({
      data: {
        userId: user.id,
        type: "security.password_changed",
        title: "Password changed",
        message: `${user.name} changed their password.`,
      },
    })
    reply.send({ data: { success: true } })
  }

  fastify.patch("/auth/password", passwordAuth, handlePasswordChange)

  /** POST alias — iOS PWA often fails CORS preflight on PATCH. */
  fastify.post("/auth/password", passwordAuth, handlePasswordChange)

  fastify.get(
    "/auth/sessions",
    { preHandler: authenticate },
    async (request, reply) => {
      if (!request.auth) return
      const currentSessionId = request.auth.session?.id ?? null
      const sessions = await fastify.prisma.session.findMany({
        where: { userId: request.auth.user.id, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
      reply.send({
        data: sessions.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ipAddress: normalizeClientIp(s.ipAddress),
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          isCurrent: currentSessionId !== null && s.id === currentSessionId,
        })),
      })
    }
  )

  const revokeSessionAuth = { preHandler: authenticate }

  async function handleRevokeSession(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth) return
    const { id } = request.params as { id: string }
    await request.server.prisma.session.deleteMany({
      where: { id, userId: request.auth.user.id },
    })
    reply.send({ data: { success: true } })
  }

  fastify.delete("/auth/sessions/:id", revokeSessionAuth, handleRevokeSession)

  /** POST alias — iOS PWA often fails CORS preflight on DELETE. */
  fastify.post("/auth/sessions/:id/revoke", revokeSessionAuth, handleRevokeSession)

  fastify.get(
    "/auth/preferences",
    { preHandler: authenticate },
    async (request, reply) => {
      if (!request.auth) return
      try {
        const preferences = await loadUserPreferences(fastify.prisma, request.auth.user.id)
        reply.send({ data: preferences })
      } catch (error) {
        request.log.error({ err: error }, "GET /auth/preferences failed")
        reply.status(500).send({
          error: {
            code: "PREFERENCES_LOAD_FAILED",
            message:
              "Could not load preferences. Run pnpm db:deploy, then restart the API (pnpm dev:api).",
          },
        })
      }
    },
  )

  const preferencesAuth = { preHandler: authenticate }

  async function handlePreferencesUpdate(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth) return
    const parsed = userPreferencesPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid preferences payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    try {
      const current = await loadUserPreferences(request.server.prisma, request.auth.user.id)
      const next = mergeUserPreferences(current, parsed.data)

      await request.server.prisma.user.update({
        where: { id: request.auth.user.id },
        data: { preferences: next },
      })

      reply.send({ data: next })
    } catch (error) {
      request.log.error({ err: error }, "auth/preferences update failed")
      reply.status(500).send({
        error: {
          code: "PREFERENCES_SAVE_FAILED",
          message:
            "Could not save preferences. Run pnpm db:deploy, then restart the API (pnpm dev:api).",
        },
      })
    }
  }

  fastify.patch("/auth/preferences", preferencesAuth, handlePreferencesUpdate)

  /** POST alias — iOS PWA often fails CORS preflight on PATCH. */
  fastify.post("/auth/preferences", preferencesAuth, handlePreferencesUpdate)

  fastify.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[apiConfig.SESSION_COOKIE_NAME]

    if (token) {
      await fastify.prisma.session.deleteMany({
        where: {
          tokenHash: hashToken(token),
        },
      })
    }

    clearSessionCookie(reply, request)

    reply.send({
      data: {
        success: true,
      },
    })
  })
}
