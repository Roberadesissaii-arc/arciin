import {
  ACCENT_COLORS,
  FONT_SIZE_OPTIONS,
  TOAST_POSITIONS,
  TOAST_STYLES,
  UI_RADIUS_OPTIONS,
  mergeUserPreferences,
  parseUserPreferences,
} from "@arciin/shared"
import { createReadStream } from "node:fs"
import { access } from "node:fs/promises"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { toDataURL } from "qrcode"
import { z } from "zod"

import { apiConfig } from "@/config"
import { serializeAuth, serializeSession, serializeUser } from "@/services/serializers"
import { loadAccessControlSettings } from "@/services/security/access-control-settings"
import {
  formatAuthSecurityMessage,
  resolveRequestClientContext,
} from "@/services/security/login-audit"
import { clientIpFromRequest, normalizeClientIp } from "@/services/security/client-ip"
import { consumeSecondFactor } from "@/services/security/mfa-challenge"
import {
  consumeMfaChallenge,
  issueMfaChallenge,
} from "@/services/security/mfa-login-challenge"
import { decryptSecret, encryptSecret } from "@/services/security/encryption"
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "@/services/security/mfa"
import { recordSecurityEvent } from "@/services/security/security-events"
import {
  authenticate,
  authenticateFlexible,
  clearSessionCookie,
  createSession,
  extractMobileSessionToken,
  hashPassword,
  hashToken,
  setSessionCookie,
  verifyPassword,
} from "@/services/security/auth"
import {
  hashRecoveryAnswer,
  verifyRecoveryAnswer,
} from "@/services/security/recovery-answer"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { resolveTrustedPairedDevice } from "@/services/devices/trusted-device"
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
import { loadUserPreferences } from "@/services/user/preferences"
import { mediaQueue } from "@/services/jobs/queues"
import { queueDocumentThumbnailBackfill } from "@/services/media/thumbnail-jobs"

const MAX_AVATAR_BYTES = 10 * 1024 * 1024

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  rememberMe: z.boolean().optional(),
  /** Six digits from the authenticator app, when the account has MFA on. */
  totp: z.string().trim().optional(),
  /** A single-use recovery code, for when the authenticator is unavailable. */
  recoveryCode: z.string().trim().optional(),
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
        toastOrbitColor: z.enum(accentValues).optional(),
        uiRadius: z.enum(UI_RADIUS_OPTIONS).optional(),
        sidebarCollapsed: z.boolean().optional(),
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
    media: z
      .object({
        documentThumbnails: z.boolean().optional(),
      })
      .optional(),
  })
  .strict()

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

      // pairedDeviceId is server-derived from the Session row. Query/body values
      // are ignored. MEMBER and VIEWER can read their own binding here; they
      // cannot call GET /api/settings/devices.
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
      reply,
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

  /**
   * Everything that happens once both factors are satisfied.
   *
   * Shared by the password-only path and the second-factor path so a session
   * can only be minted in one place.
   */
  async function completeSignIn(
    request: FastifyRequest,
    reply: FastifyReply,
    user: { id: string; name: string },
    rememberMe: boolean,
  ) {
    const access = await loadAccessControlSettings(fastify.prisma)
    // Remember me → 30-day session with a persistent cookie. Otherwise the
    // session keeps the configured timeout and the cookie dies with the browser.
    const trustedDevice = await resolveTrustedPairedDevice(request)
    const { session, rawToken } = await createSession(
      request,
      user.id,
      rememberMe
        ? { expiresInDays: 30, reply, pairedDeviceId: trustedDevice?.id ?? null }
        : {
            expiresInMinutes: access.sessionTimeoutMinutes,
            reply,
            pairedDeviceId: trustedDevice?.id ?? null,
          },
    )
    setSessionCookie(reply, rawToken, session.expiresAt, request, {
      persistent: rememberMe,
    })

    const ctx = resolveRequestClientContext(request)
    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.login",
      title: "Signed in",
      message: formatAuthSecurityMessage(user.name, ctx.ip, ctx.deviceLabel),
      metadata: {
        clientIp: ctx.normalizedIp,
        deviceLabel: ctx.deviceLabel ?? undefined,
        userAgent: ctx.userAgent,
        status: "ok",
      },
    })

    reply.send({ data: serializeAuth(user as never, session) })
  }

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
    const clientIp = clientIpFromRequest(request)
    const lock = await isLoginLocked(fastify, email, clientIp)
    if (lock.locked) {
      reply.status(429).send({
        error: {
          code: "TOO_MANY_ATTEMPTS",
          message: `Too many failed sign-in attempts from this device. Try again in about 15 minutes.`,
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

    /**
     * Second factor, if this account has one.
     *
     * Deliberately after the password check: asking for a code before the
     * password is right would tell an unauthenticated caller which addresses
     * exist and which have MFA on.
     *
     * No session is created here. The caller gets a short-lived ticket and
     * comes back to /auth/mfa/challenge with a code, so the password crosses
     * the wire once rather than being held in the page until someone finds
     * their phone.
     */
    if (user.mfaEnabledAt) {
      await clearFailedLoginAttempts(fastify, email, clientIp)
      const challenge = await issueMfaChallenge(fastify, {
        userId: user.id,
        clientIp,
        rememberMe: parsed.data.rememberMe === true,
      })
      reply.send({
        data: {
          mfaRequired: true,
          challengeToken: challenge.token,
          expiresInSeconds: challenge.expiresInSeconds,
        },
      })
      return
    }

    await clearFailedLoginAttempts(fastify, email, clientIp)
    await completeSignIn(request, reply, user, parsed.data.rememberMe === true)
  })

  const mfaChallengeSchema = z.object({
    challengeToken: z.string().min(16),
    totp: z.string().trim().optional(),
    recoveryCode: z.string().trim().optional(),
  })

  /**
   * Exchange a ticket plus a code for a session.
   *
   * Unauthenticated by design — the ticket is what stands in for the password
   * here, and it is worth nothing without a valid code.
   */
  fastify.post("/auth/mfa/challenge", async (request, reply) => {
    if (await checkEndpointRateLimit(request, reply, { key: "mfa", limit: 10, windowSec: 300 })) {
      return
    }
    const parsed = mfaChallengeSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Provide the challenge and a code." },
      })
      return
    }

    const clientIp = clientIpFromRequest(request)
    const pending = await consumeMfaChallenge(fastify, parsed.data.challengeToken, clientIp)
    if (!pending) {
      // Expired, already spent, or presented from a different address. One
      // message for all three: which it was is not the caller's business.
      reply.status(401).send({
        error: {
          code: "MFA_CHALLENGE_INVALID",
          message: "That sign-in attempt has expired. Start again.",
        },
      })
      return
    }

    const user = await fastify.prisma.user.findUnique({ where: { id: pending.userId } })
    if (!user || user.status !== "ACTIVE" || !user.mfaEnabledAt) {
      reply.status(401).send({
        error: { code: "MFA_CHALLENGE_INVALID", message: "That sign-in attempt is no longer valid." },
      })
      return
    }

    const outcome = await consumeSecondFactor(request, reply, user, {
      totp: parsed.data.totp,
      recoveryCode: parsed.data.recoveryCode,
    })
    if (outcome !== "accepted") return

    await completeSignIn(request, reply, user, pending.rememberMe)
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

  /**
   * Begin enrolment.
   *
   * The secret is stored encrypted immediately but MFA stays off until a code
   * proves the authenticator actually holds it — enabling first would lock the
   * owner out of their own instance if the QR code never scanned properly.
   *
   * Re-enrolling while already enabled is refused rather than silently
   * replacing the secret, which would be a quiet way to take an account over
   * from a borrowed session.
   */
  const mfaEnrollSchema = z.object({ password: z.string().min(1) })

  fastify.post("/auth/mfa/enroll", profileAuth, async (request, reply) => {
    if (!request.auth) return
    const user = request.auth.user

    /**
     * The current password, even though the caller is already signed in.
     *
     * Starting an enrolment replaces whatever secret was pending, so a
     * borrowed or forgotten session should not be enough to point the second
     * factor at an attacker's phone.
     */
    const parsedEnroll = mfaEnrollSchema.safeParse(request.body)
    if (!parsedEnroll.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Confirm your password to begin." },
      })
      return
    }
    if (await checkEndpointRateLimit(request, reply, { key: "mfa", limit: 10, windowSec: 300 })) {
      return
    }
    if (!(await verifyPassword(parsedEnroll.data.password, user.passwordHash))) {
      reply.status(401).send({
        error: { code: "INVALID_CREDENTIALS", message: "Password is incorrect." },
      })
      return
    }

    if (user.mfaEnabledAt) {
      reply.status(409).send({
        error: {
          code: "MFA_ALREADY_ENABLED",
          message: "Two-factor authentication is already on. Turn it off before enrolling again.",
        },
      })
      return
    }

    const secret = generateTotpSecret()
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: encryptSecret(secret), mfaLastUsedStep: null },
    })

    const otpauthUri = buildOtpAuthUri({
      secret,
      accountName: user.email,
      issuer: "Arciin",
    })

    // The secret travels exactly once, to the person enrolling. After
    // verification it is never returned again.
    reply.send({
      data: {
        secret,
        otpauthUri,
        // Wider quiet zone and a larger bitmap: this gets scanned from a
        // phone held at arm's length, not inspected on screen.
        qrDataUrl: await toDataURL(otpauthUri, { margin: 2, width: 320 }),
      },
    })
  })

  const mfaVerifySchema = z.object({ totp: z.string().trim() })

  /** Finish enrolment: prove the code works, then switch MFA on. */
  fastify.post("/auth/mfa/enroll/verify", profileAuth, async (request, reply) => {
    if (!request.auth) return
    const user = request.auth.user
    if (user.mfaEnabledAt) {
      reply.status(409).send({
        error: { code: "MFA_ALREADY_ENABLED", message: "Two-factor authentication is already on." },
      })
      return
    }
    if (!user.mfaSecretEnc) {
      reply.status(400).send({
        error: { code: "MFA_NOT_STARTED", message: "Start enrolment before verifying a code." },
      })
      return
    }
    const parsed = mfaVerifySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Provide the six-digit code." },
      })
      return
    }
    if (await checkEndpointRateLimit(request, reply, { key: "mfa", limit: 10, windowSec: 300 })) {
      return
    }

    const result = verifyTotp({
      token: parsed.data.totp,
      secret: decryptSecret(user.mfaSecretEnc),
      lastUsedStep: null,
    })
    if (!result.ok) {
      reply.status(400).send({
        error: { code: "MFA_INVALID", message: "That code is not valid." },
      })
      return
    }

    const codes = generateRecoveryCodes()
    await fastify.prisma.$transaction([
      fastify.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabledAt: new Date(), mfaLastUsedStep: BigInt(result.step) },
      }),
      fastify.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      fastify.prisma.mfaRecoveryCode.createMany({
        data: codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })),
      }),
    ])

    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.mfa_enabled",
      title: "Two-factor authentication enabled",
      message: "An authenticator app was enrolled for this account.",
      metadata: { status: "ok" },
    })

    // Shown once. Only hashes are kept.
    reply.send({ data: { enabled: true, recoveryCodes: codes } })
  })

  const mfaSensitiveSchema = z.object({
    password: z.string().min(1),
    totp: z.string().trim().optional(),
    recoveryCode: z.string().trim().optional(),
  })

  /**
   * Both of the dangerous operations — turning MFA off, and replacing the
   * recovery codes — need the password *and* a current second factor. A
   * borrowed session alone is not enough to undo the protection.
   */
  async function requirePasswordAndSecondFactor(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> {
    if (!request.auth) return false
    const user = request.auth.user
    const parsed = mfaSensitiveSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Password and a current code are required." },
      })
      return false
    }
    if (await checkEndpointRateLimit(request, reply, { key: "mfa", limit: 10, windowSec: 300 })) {
      return false
    }
    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      reply.status(401).send({
        error: { code: "INVALID_CREDENTIALS", message: "Password is incorrect." },
      })
      return false
    }
    const outcome = await consumeSecondFactor(request, reply, user, {
      totp: parsed.data.totp,
      recoveryCode: parsed.data.recoveryCode,
    })
    return outcome === "accepted"
  }

  fastify.post("/auth/mfa/disable", profileAuth, async (request, reply) => {
    if (!request.auth) return
    const user = request.auth.user
    if (!user.mfaEnabledAt) {
      reply.status(400).send({
        error: { code: "MFA_NOT_ENABLED", message: "Two-factor authentication is not on." },
      })
      return
    }
    if (!(await requirePasswordAndSecondFactor(request, reply))) return

    await fastify.prisma.$transaction([
      fastify.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastUsedStep: null },
      }),
      fastify.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ])

    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.mfa_disabled",
      title: "Two-factor authentication disabled",
      message: "The authenticator app was removed from this account.",
      metadata: { status: "warning" },
    })
    reply.send({ data: { enabled: false } })
  })

  /** Replace every recovery code. The previous set stops working immediately. */
  fastify.post("/auth/mfa/recovery-codes", profileAuth, async (request, reply) => {
    if (!request.auth) return
    const user = request.auth.user
    if (!user.mfaEnabledAt) {
      reply.status(400).send({
        error: { code: "MFA_NOT_ENABLED", message: "Two-factor authentication is not on." },
      })
      return
    }
    if (!(await requirePasswordAndSecondFactor(request, reply))) return

    const codes = generateRecoveryCodes()
    await fastify.prisma.$transaction([
      fastify.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      fastify.prisma.mfaRecoveryCode.createMany({
        data: codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })),
      }),
    ])

    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.mfa_recovery_regenerated",
      title: "Recovery codes replaced",
      message: "A new set of recovery codes was issued; the previous set no longer works.",
      metadata: { status: "warning" },
    })
    reply.send({ data: { recoveryCodes: codes } })
  })

  /** Status for the settings screen. Never includes the secret. */
  fastify.get("/auth/mfa", profileAuth, async (request, reply) => {
    if (!request.auth) return
    const user = request.auth.user
    const remaining = user.mfaEnabledAt
      ? await fastify.prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } })
      : 0
    reply.send({
      data: {
        enabled: Boolean(user.mfaEnabledAt),
        enabledAt: user.mfaEnabledAt?.toISOString() ?? null,
        enrollmentStarted: Boolean(user.mfaSecretEnc) && !user.mfaEnabledAt,
        recoveryCodesRemaining: remaining,
      },
    })
  })


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

      // Cap avatar size here — the global multipart limit is huge (asset uploads
      // stream to disk) and toBuffer() below reads the whole file into memory.
      const file = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES } })
      if (!file) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Choose an image file to upload." },
        })
        return
      }

      let buffer: Buffer
      try {
        buffer = await file.toBuffer()
      } catch {
        reply.status(413).send({
          error: {
            code: "AVATAR_TOO_LARGE",
            message: `Profile images must be ${Math.floor(MAX_AVATAR_BYTES / (1024 * 1024))} MB or smaller.`,
          },
        })
        return
      }
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
    /**
     * Defaults to true, because the usual reason for changing a password is
     * that somebody thinks it is known. Leaving other sessions signed in would
     * defeat the change for exactly the case it is meant to answer.
     */
    signOutOtherSessions: z.boolean().optional(),
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
    /**
     * Sign out everywhere else.
     *
     * The Session rows go; the Device pairing rows do not. A paired Desktop
     * therefore loses its session and gets a new one from its own device
     * credential, rather than having to be paired again from scratch — the
     * pairing is a separate credential from the password, and a password
     * change is not a reason to make somebody walk to the other machine.
     */
    const signOutOthers = parsed.data.signOutOtherSessions !== false
    let revoked = 0
    if (signOutOthers) {
      const currentToken = request.cookies[apiConfig.SESSION_COOKIE_NAME]
      const currentHash = currentToken ? hashToken(currentToken) : null
      const result = await request.server.prisma.session.deleteMany({
        where: {
          userId: user.id,
          ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
        },
      })
      revoked = result.count
    }

    await request.server.prisma.activityEvent.create({
      data: {
        userId: user.id,
        type: "security.password_changed",
        title: "Password changed",
        message: signOutOthers
          ? `${user.name} changed their password and signed out ${revoked} other session(s).`
          : `${user.name} changed their password.`,
      },
    })
    reply.send({ data: { success: true, otherSessionsRevoked: revoked } })
  }

  /** The same thing on its own, for Account → Sessions. */
  fastify.post("/auth/sessions/revoke-others", passwordAuth, async (request, reply) => {
    if (!request.auth) return
    const user = request.auth.user
    const currentToken = request.cookies[apiConfig.SESSION_COOKIE_NAME]
    const currentHash = currentToken ? hashToken(currentToken) : null
    const result = await request.server.prisma.session.deleteMany({
      where: {
        userId: user.id,
        ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
      },
    })
    await recordSecurityEvent(request.server, {
      userId: user.id,
      type: "auth.sessions_revoked",
      title: "Other sessions signed out",
      message: `${user.name} signed out ${result.count} other session(s).`,
      metadata: { status: "ok" },
    })
    reply.send({ data: { revoked: result.count } })
  })

  fastify.patch("/auth/password", passwordAuth, handlePasswordChange)

  /** POST alias — iOS PWA often fails CORS preflight on PATCH. */
  fastify.post("/auth/password", passwordAuth, handlePasswordChange)

  const recoveryQuestionSchema = z.string().trim().min(4).max(200)
  const recoveryAnswerSchema = z.string().trim().min(2).max(200)

  const recoverySetupSchema = z.object({
    question: recoveryQuestionSchema,
    answer: recoveryAnswerSchema,
  })

  fastify.post("/auth/recovery/setup", passwordAuth, async (request, reply) => {
    if (!request.auth) return
    if (
      await checkEndpointRateLimit(request, reply, {
        key: "recovery-setup",
        limit: 10,
        windowSec: 3600,
      })
    ) {
      return
    }

    const parsed = recoverySetupSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid recovery question or answer.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const answerHash = await hashRecoveryAnswer(parsed.data.answer)
    await request.server.prisma.user.update({
      where: { id: request.auth.user.id },
      data: {
        recoveryQuestion: parsed.data.question,
        recoveryAnswerHash: answerHash,
      },
    })

    reply.send({ data: { success: true } })
  })

  const recoveryLookupSchema = z.object({
    email: z.email(),
  })

  fastify.post("/auth/recovery/lookup", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: "recovery-lookup",
        limit: 20,
        windowSec: 3600,
      })
    ) {
      return
    }

    const parsed = recoveryLookupSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a valid email address.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const user = await request.server.prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: {
        recoveryQuestion: true,
        recoveryAnswerHash: true,
        status: true,
      },
    })

    const available =
      user?.status === "ACTIVE" &&
      Boolean(user.recoveryQuestion?.trim()) &&
      Boolean(user.recoveryAnswerHash)

    reply.send({
      data: {
        available,
        question: available ? user!.recoveryQuestion! : undefined,
      },
    })
  })

  const recoveryResetSchema = z.object({
    email: z.email(),
    answer: recoveryAnswerSchema,
    newPassword: z.string().min(8),
  })

  const recoveryAttemptKey = (email: string) => `arciin:recovery-fails:${email.toLowerCase()}`
  const RECOVERY_MAX_ATTEMPTS = 8
  const RECOVERY_LOCKOUT_WINDOW_SEC = 3600

  fastify.post("/auth/recovery/reset", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: "recovery-reset",
        limit: 10,
        windowSec: 3600,
      })
    ) {
      return
    }

    const parsed = recoveryResetSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid reset payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const email = parsed.data.email.toLowerCase()
    const attemptKey = recoveryAttemptKey(email)
    const attempts = Number((await request.server.redis.get(attemptKey)) ?? 0)

    const genericFailure = () => {
      reply.status(400).send({
        error: {
          code: "RECOVERY_FAILED",
          message:
            "Could not reset your password. Check your email and security answer, or ask an admin for help.",
        },
      })
    }

    if (attempts >= RECOVERY_MAX_ATTEMPTS) {
      reply.status(429).send({
        error: {
          code: "RECOVERY_LOCKED",
          message: "Too many failed recovery attempts for this account. Try again later or ask an admin for help.",
        },
      })
      return
    }

    const user = await request.server.prisma.user.findUnique({
      where: { email },
    })

    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.recoveryQuestion?.trim() ||
      !user.recoveryAnswerHash
    ) {
      genericFailure()
      return
    }

    const answerOk = await verifyRecoveryAnswer(parsed.data.answer, user.recoveryAnswerHash)
    if (!answerOk) {
      const nextAttempts = await request.server.redis.incr(attemptKey)
      if (nextAttempts === 1) {
        await request.server.redis.expire(attemptKey, RECOVERY_LOCKOUT_WINDOW_SEC)
      }
      await recordSecurityEvent(request.server, {
        userId: user.id,
        type: "security.recovery_failed",
        title: "Password recovery failed",
        message: "A password recovery attempt used an incorrect security answer.",
      })
      genericFailure()
      return
    }

    await request.server.redis.del(attemptKey)

    const passwordHash = await hashPassword(parsed.data.newPassword)
    await request.server.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    // Revoke every existing session — anyone holding an old cookie (including a
    // possible attacker) must sign in again with the new password.
    await request.server.prisma.session.deleteMany({
      where: { userId: user.id },
    })

    await request.server.prisma.activityEvent.create({
      data: {
        userId: user.id,
        type: "security.password_recovered",
        title: "Password recovered",
        message: `${user.name} reset their password using a security question.`,
      },
    })

    reply.send({ data: { success: true } })
  })

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
      const user = await request.server.prisma.user.findUnique({
        where: { id: request.auth.user.id },
        select: { preferences: true },
      })
      const root =
        user?.preferences &&
        typeof user.preferences === "object" &&
        !Array.isArray(user.preferences)
          ? { ...(user.preferences as Record<string, unknown>) }
          : {}

      const current = parseUserPreferences(root)
      const next = mergeUserPreferences(current, parsed.data)
      const merged: Record<string, unknown> = {
        ...root,
        notifications: next.notifications,
        appearance: next.appearance,
        accessibility: next.accessibility,
        media: next.media,
      }

      await request.server.prisma.user.update({
        where: { id: request.auth.user.id },
        data: { preferences: merged as import("@prisma/client").Prisma.InputJsonValue },
      })

      const enabledDocs =
        !current.media.documentThumbnails && next.media.documentThumbnails
      if (enabledDocs) {
        const instance = await request.server.prisma.instanceConfig.findFirst()
        void queueDocumentThumbnailBackfill(
          request.server.prisma,
          mediaQueue,
          request.auth.user.id,
          instance?.storageRoot,
        ).catch((err) => {
          request.log.warn({ err }, "document thumbnail backfill failed")
        })
      }

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
    // Cookie sessions (web) or Bearer sessions (mobile PWA) — logout must revoke
    // whichever credential the caller actually used, not just the cookie.
    const token = request.cookies[apiConfig.SESSION_COOKIE_NAME] ?? extractMobileSessionToken(request)

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
