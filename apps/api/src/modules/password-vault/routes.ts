import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { isVaultImportEntry, parsePasswordImportFile } from "@arciin/shared"

import {
  requireFeature,
  requireSessionRole,
  verifyPassword,
} from "@/services/security/auth"
import {
  mergePasswordVaultDisplay,
  readPasswordVaultDisplay,
  toPrismaAiConfig,
} from "@/services/password-vault/config"
import { decryptVaultPayload, encryptVaultPayload } from "@/services/password-vault/crypto"
import { getPasswordVaultAiSnapshot } from "@/services/password-vault/vault-for-ai"
import {
  hashVaultPin,
  mergePasswordVaultPin,
  readPasswordVaultPin,
  readPasswordVaultPinHash,
  verifyVaultPin,
} from "@/services/password-vault/pin"
import {
  clearVaultUnlockCookie,
  isVaultUnlockValid,
  issueVaultUnlockCookie,
  vaultUnlockExpiresAt,
} from "@/services/password-vault/unlock-cookie"

const displayPatchSchema = z.object({
  showUsername: z.boolean().optional(),
  showUrl: z.boolean().optional(),
  showNotes: z.boolean().optional(),
  showCategory: z.boolean().optional(),
  showPasswordColumn: z.boolean().optional(),
  maskStyle: z.enum(["dots", "asterisk", "block"]).optional(),
  revealByDefault: z.boolean().optional(),
  lockSidebarVault: z.boolean().optional(),
  accountPassword: z.string().min(1).max(512).optional(),
})

const importSchema = z.object({
  text: z.string().min(1).max(5_000_000),
  fileName: z.string().max(255).optional(),
  replace: z.boolean().optional(),
})

const pinSchema = z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits.")

const unlockSchema = z
  .object({
    password: z.string().min(1).max(512).optional(),
    pin: pinSchema.optional(),
  })
  .refine((body) => Boolean(body.password) !== Boolean(body.pin), {
    message: "Provide account password or 6-digit PIN.",
  })

const setPinSchema = z
  .object({
    pin: pinSchema,
    confirmPin: pinSchema,
    accountPassword: z.string().min(1).max(512),
  })
  .refine((body) => body.pin === body.confirmPin, {
    message: "PIN confirmation does not match.",
    path: ["confirmPin"],
  })

const removePinSchema = z.object({
  accountPassword: z.string().min(1).max(512),
})

const updateEntrySchema = z.object({
  name: z.string().min(1).max(500).optional(),
  username: z.string().max(500).optional(),
  password: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
  category: z.string().max(200).optional(),
})

const VAULT_UNLOCK_MAX_ATTEMPTS = 8
const VAULT_UNLOCK_LOCKOUT_WINDOW_SEC = 900

function vaultUnlockAttemptKey(userId: string) {
  return `arciin:vault-unlock-fails:${userId}`
}

async function unlockVaultWithCredential(
  fastify: FastifyInstance,
  userId: string,
  body: { password?: string; pin?: string },
  aiConfig: unknown,
) {
  const attemptKey = vaultUnlockAttemptKey(userId)
  const attempts = Number((await fastify.redis.get(attemptKey)) ?? 0)
  if (attempts >= VAULT_UNLOCK_MAX_ATTEMPTS) {
    return { ok: false as const, code: "LOCKED" as const }
  }

  const fail = async () => {
    const next = await fastify.redis.incr(attemptKey)
    if (next === 1) {
      await fastify.redis.expire(attemptKey, VAULT_UNLOCK_LOCKOUT_WINDOW_SEC)
    }
  }

  if (body.pin) {
    const pinHash = readPasswordVaultPinHash(aiConfig)
    if (!pinHash || !(await verifyVaultPin(body.pin, pinHash))) {
      await fail()
      return { ok: false as const, code: "INVALID_PIN" as const }
    }
    await fastify.redis.del(attemptKey)
    return { ok: true as const }
  }

  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  if (!user?.passwordHash || !(await verifyPassword(body.password!, user.passwordHash))) {
    await fail()
    return { ok: false as const, code: "INVALID_PASSWORD" as const }
  }
  await fastify.redis.del(attemptKey)
  return { ok: true as const }
}

function serializeEntry(row: {
  id: string
  ciphertext: string
  iv: string
  authTag: string
  importSource: string | null
  createdAt: Date
  updatedAt: Date
}) {
  const payload = decryptVaultPayload(row.ciphertext, row.iv, row.authTag)
  return {
    id: row.id,
    name: payload.name,
    username: payload.username ?? null,
    password: payload.password ?? null,
    url: payload.url ?? null,
    notes: payload.notes ?? null,
    category: payload.category ?? null,
    importSource: row.importSource,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function redactSecrets<T extends { password: string | null }>(
  entry: T,
  visible: boolean,
): T & { passwordLength?: number; hasPassword?: boolean } {
  if (visible) {
    const copy = { ...entry } as T & {
      passwordLength?: number
      hasPassword?: boolean
    }
    delete copy.passwordLength
    delete copy.hasPassword
    return copy as T
  }
  const hasPassword = Boolean(entry.password)
  return {
    ...entry,
    password: null,
    passwordLength: entry.password?.length ?? 0,
    hasPassword,
  }
}

export async function registerPasswordVaultRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/settings/password-vault",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const userId = request.auth!.user.id
      const [rows, instance] = await Promise.all([
        fastify.prisma.passwordVaultEntry.findMany({
          orderBy: { createdAt: "desc" },
          take: 500,
        }),
        fastify.prisma.instanceConfig.findFirst({ select: { aiConfig: true } }),
      ])
      const display = readPasswordVaultDisplay(instance?.aiConfig)
      const total = rows.length
      const lockRequired = display.lockSidebarVault && total > 0
      const secretsVisible =
        !lockRequired || isVaultUnlockValid(request, userId, request.auth?.session)

      const pin = readPasswordVaultPin(instance?.aiConfig)

      reply.send({
        data: {
          entries: rows.map((r) => redactSecrets(serializeEntry(r), secretsVisible)),
          total,
          display,
          lockRequired,
          secretsVisible,
          pinConfigured: pin.pinConfigured,
        },
      })
    },
  )

  fastify.post(
    "/settings/password-vault/unlock",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const parsed = unlockSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Password required." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { aiConfig: true },
      })
      const userId = request.auth!.user.id
      const result = await unlockVaultWithCredential(
        fastify,
        userId,
        parsed.data,
        instance?.aiConfig,
      )
      if (!result.ok) {
        if (result.code === "LOCKED") {
          reply.status(429).send({
            error: {
              code: "LOCKED",
              message: "Too many failed vault unlock attempts. Try again later.",
            },
          })
          return
        }
        reply.status(401).send({
          error: {
            code: result.code,
            message:
              result.code === "INVALID_PIN"
                ? "Incorrect vault PIN."
                : "Incorrect account password.",
          },
        })
        return
      }

      issueVaultUnlockCookie(reply, userId)
      const sessionId = request.auth?.session?.id
      if (sessionId) {
        await fastify.prisma.session.update({
          where: { id: sessionId },
          data: { vaultUnlockedUntil: vaultUnlockExpiresAt() },
        })
      }
      reply.send({ data: { unlocked: true, expiresInMinutes: 15 } })
    },
  )

  fastify.post(
    "/settings/password-vault/verify",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const parsed = unlockSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Password or PIN required." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { aiConfig: true },
      })
      const result = await unlockVaultWithCredential(
        fastify,
        request.auth!.user.id,
        parsed.data,
        instance?.aiConfig,
      )
      if (!result.ok) {
        if (result.code === "LOCKED") {
          reply.status(429).send({
            error: {
              code: "LOCKED",
              message: "Too many failed vault unlock attempts. Try again later.",
            },
          })
          return
        }
        reply.status(401).send({
          error: {
            code: result.code,
            message:
              result.code === "INVALID_PIN"
                ? "Incorrect vault PIN."
                : "Incorrect account password.",
          },
        })
        return
      }

      reply.send({ data: { verified: true } })
    },
  )

  fastify.post(
    "/settings/password-vault/:id/reveal",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = unlockSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Password or PIN required." },
        })
        return
      }

      const row = await fastify.prisma.passwordVaultEntry.findUnique({ where: { id } })
      if (!row) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Entry not found." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { aiConfig: true },
      })
      const result = await unlockVaultWithCredential(
        fastify,
        request.auth!.user.id,
        parsed.data,
        instance?.aiConfig,
      )
      if (!result.ok) {
        if (result.code === "LOCKED") {
          reply.status(429).send({
            error: {
              code: "LOCKED",
              message: "Too many failed vault unlock attempts. Try again later.",
            },
          })
          return
        }
        reply.status(401).send({
          error: {
            code: result.code,
            message:
              result.code === "INVALID_PIN"
                ? "Incorrect vault PIN."
                : "Incorrect account password.",
          },
        })
        return
      }

      reply.send({ data: serializeEntry(row) })
    },
  )

  fastify.post(
    "/settings/password-vault/pin",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const parsed = setPinSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid PIN payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: request.auth!.user.id },
        select: { passwordHash: true },
      })
      if (!user || !(await verifyPassword(parsed.data.accountPassword, user.passwordHash))) {
        reply.status(401).send({
          error: { code: "INVALID_PASSWORD", message: "Incorrect account password." },
        })
        return
      }

      const pinHash = await hashVaultPin(parsed.data.pin)
      const nextAi = mergePasswordVaultPin(instance.aiConfig, pinHash)
      await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { aiConfig: toPrismaAiConfig(nextAi) },
      })

      reply.send({ data: { pinConfigured: true } })
    },
  )

  fastify.delete(
    "/settings/password-vault/pin",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const parsed = removePinSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Account password required." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: request.auth!.user.id },
        select: { passwordHash: true },
      })
      if (!user || !(await verifyPassword(parsed.data.accountPassword, user.passwordHash))) {
        reply.status(401).send({
          error: { code: "INVALID_PASSWORD", message: "Incorrect account password." },
        })
        return
      }

      const nextAi = mergePasswordVaultPin(instance.aiConfig, null)
      await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { aiConfig: toPrismaAiConfig(nextAi) },
      })

      reply.send({ data: { pinConfigured: false } })
    },
  )

  fastify.post(
    "/settings/password-vault/lock",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      clearVaultUnlockCookie(reply)
      const sessionId = request.auth?.session?.id
      if (sessionId) {
        await fastify.prisma.session.update({
          where: { id: sessionId },
          data: { vaultUnlockedUntil: null },
        })
      }
      reply.send({ data: { locked: true } })
    },
  )

  const vaultDisplayAuth = { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] }

  async function handlePasswordVaultDisplayPatch(request: FastifyRequest, reply: FastifyReply) {
    const parsed = displayPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid display settings." },
      })
      return
    }

    const instance = await fastify.prisma.instanceConfig.findFirst()
    if (!instance) {
      reply.status(409).send({
        error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." },
      })
      return
    }

    const currentDisplay = readPasswordVaultDisplay(instance.aiConfig)
    if (parsed.data.revealByDefault === true && !currentDisplay.revealByDefault) {
      const password = parsed.data.accountPassword
      if (!password) {
        reply.status(400).send({
          error: {
            code: "PASSWORD_REQUIRED",
            message: "Account password is required to enable reveal by default.",
          },
        })
        return
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: request.auth!.user.id },
        select: { passwordHash: true },
      })
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        reply.status(401).send({
          error: {
            code: "INVALID_PASSWORD",
            message: "Incorrect account password.",
          },
        })
        return
      }
    }

    const { accountPassword, ...displayPatch } = parsed.data
    void accountPassword
    const nextAi = mergePasswordVaultDisplay(instance.aiConfig, displayPatch)
    await fastify.prisma.instanceConfig.update({
      where: { id: instance.id },
      data: { aiConfig: toPrismaAiConfig(nextAi) },
    })

    reply.send({ data: readPasswordVaultDisplay(nextAi) })
  }

  fastify.patch("/settings/password-vault/display", vaultDisplayAuth, handlePasswordVaultDisplayPatch)

  /** POST alias — iOS PWA often fails CORS preflight on PATCH. */
  fastify.post("/settings/password-vault/display", vaultDisplayAuth, handlePasswordVaultDisplayPatch)

  fastify.get(
    "/settings/password-vault/ai-snapshot",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (_request, reply) => {
      reply.send({ data: await getPasswordVaultAiSnapshot(fastify.prisma) })
    },
  )

  fastify.post(
    "/settings/password-vault/import",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const parsed = importSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid import payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const entries = parsePasswordImportFile(parsed.data.text, parsed.data.fileName).filter(isVaultImportEntry)

      if (entries.length === 0) {
        reply.status(400).send({
          error: {
            code: "NO_ENTRIES",
            message: "No password entries could be parsed from that file.",
          },
        })
        return
      }

      if (parsed.data.replace) {
        await fastify.prisma.passwordVaultEntry.deleteMany()
      }

      // Encrypt then insert in chunks — parallel create() of 100+ rows can stall the API
      // and freeze the settings UI after a large Edge/Chrome export.
      const source = parsed.data.fileName ?? "import"
      const prepared = entries.map((entry) => {
        const enc = encryptVaultPayload({
          name: entry.name,
          username: entry.username,
          password: entry.password,
          url: entry.url,
          notes: entry.notes,
          category: entry.category,
        })
        return {
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          importSource: source,
        }
      })

      const CHUNK = 40
      let imported = 0
      for (let i = 0; i < prepared.length; i += CHUNK) {
        const slice = prepared.slice(i, i + CHUNK)
        const result = await fastify.prisma.passwordVaultEntry.createMany({
          data: slice,
        })
        imported += result.count
      }

      reply.send({
        data: {
          imported,
        },
      })
    },
  )

  fastify.delete(
    "/settings/password-vault",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (_request, reply) => {
      const result = await fastify.prisma.passwordVaultEntry.deleteMany()
      reply.send({ data: { deleted: result.count } })
    },
  )

  fastify.patch(
    "/settings/password-vault/:id",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = updateEntrySchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid entry payload." },
        })
        return
      }

      const existing = await fastify.prisma.passwordVaultEntry.findUnique({ where: { id } })
      if (!existing) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Entry not found." } })
        return
      }

      const current = decryptVaultPayload(existing.ciphertext, existing.iv, existing.authTag)
      const next = {
        name: parsed.data.name ?? current.name,
        username: parsed.data.username ?? current.username,
        password: parsed.data.password ?? current.password,
        url: parsed.data.url ?? current.url,
        notes: parsed.data.notes ?? current.notes,
        category: parsed.data.category ?? current.category,
      }
      const enc = encryptVaultPayload(next)
      const row = await fastify.prisma.passwordVaultEntry.update({
        where: { id },
        data: {
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
        },
      })

      const userId = request.auth!.user.id
      const instance = await fastify.prisma.instanceConfig.findFirst({ select: { aiConfig: true } })
      const display = readPasswordVaultDisplay(instance?.aiConfig)
      const secretsVisible =
        !display.lockSidebarVault || isVaultUnlockValid(request, userId, request.auth?.session)

      reply.send({ data: redactSecrets(serializeEntry(row), secretsVisible) })
    },
  )

  fastify.delete(
    "/settings/password-vault/:id",
    { preHandler: [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("vault.password")] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      await fastify.prisma.passwordVaultEntry.delete({ where: { id } })
      reply.send({ data: { success: true } })
    },
  )
}
