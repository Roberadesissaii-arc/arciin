import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireRole } from "@/services/security/auth"

const OLLAMA_PROVIDERS = new Set(["ollama", "ollama-local", "ollama-cloud"])

function ollamaNativeBase(provider: string, baseUrl: string | null): string {
  const raw = baseUrl ?? (provider === "ollama-cloud" ? "https://ollama.com" : "http://localhost:11434")
  return raw.replace(/\/v1\/?$/, "").replace(/\/$/, "")
}

const upsertSchema = z.object({
  provider:     z.string().min(1).max(64),
  displayName:  z.string().min(1).max(100),
  apiKey:       z.string().max(512).optional().nullable(),
  baseUrl:      z.string().url().max(512).optional().nullable(),
  defaultModel: z.string().max(200).optional().nullable(),
  isDefault:    z.boolean().optional(),
  isEnabled:    z.boolean().optional(),
})

function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 8) return "••••••••"
  return key.slice(0, 4) + "••••" + key.slice(-4)
}

function serializeProfile(p: {
  id: string
  provider: string
  displayName: string
  apiKey: string | null
  baseUrl: string | null
  defaultModel: string | null
  isDefault: boolean
  isEnabled: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id:           p.id,
    provider:     p.provider,
    displayName:  p.displayName,
    apiKeyMasked: maskKey(p.apiKey),
    hasApiKey:    Boolean(p.apiKey),
    baseUrl:      p.baseUrl,
    defaultModel: p.defaultModel,
    isDefault:    p.isDefault,
    isEnabled:    p.isEnabled,
    createdAt:    p.createdAt.toISOString(),
    updatedAt:    p.updatedAt.toISOString(),
  }
}

export async function registerModelRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/models",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (_request, reply) => {
      const profiles = await fastify.prisma.modelProfile.findMany({
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        take: 50,
      })
      reply.send({ data: profiles.map(serializeProfile) })
    },
  )

  fastify.post(
    "/models",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = upsertSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }
      const { isDefault, ...rest } = parsed.data

      // If setting as default, clear others first
      if (isDefault) {
        await fastify.prisma.modelProfile.updateMany({ data: { isDefault: false } })
      }

      const profile = await fastify.prisma.modelProfile.create({
        data: { ...rest, isDefault: isDefault ?? false },
      })
      reply.status(201).send({ data: serializeProfile(profile) })
    },
  )

  fastify.patch(
    "/models/:id",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = upsertSchema.partial().safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }

      const existing = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!existing) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }

      if (parsed.data.isDefault) {
        await fastify.prisma.modelProfile.updateMany({ data: { isDefault: false } })
      }

      // Preserve existing API key when not provided in the patch
      const data: Record<string, unknown> = { ...parsed.data }
      if (!("apiKey" in parsed.data)) delete data.apiKey

      const updated = await fastify.prisma.modelProfile.update({ where: { id }, data })
      reply.send({ data: serializeProfile(updated) })
    },
  )

  fastify.delete(
    "/models/:id",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const existing = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!existing) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      await fastify.prisma.modelProfile.delete({ where: { id } })
      reply.send({ data: { success: true } })
    },
  )

  // ── Fetch available models from an Ollama instance ──────────────────────────
  fastify.get(
    "/models/:id/available-models",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!profile) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }

      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({ error: { code: "NOT_SUPPORTED", message: "Dynamic model listing is only supported for Ollama." } })
        return
      }

      const baseUrl = ollamaNativeBase(profile.provider, profile.baseUrl)
      const headers: Record<string, string> = {}
      if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`

      const timeoutMs = profile.provider === "ollama-cloud" ? 20_000 : 10_000

      try {
        const res = await fetch(`${baseUrl}/api/tags`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status === 401 || res.status === 403) {
          reply.status(502).send({
            error: {
              code: "OLLAMA_AUTH",
              message:
                profile.provider === "ollama-cloud"
                  ? "Ollama Cloud rejected the API key. Update it under Models → Ollama Cloud."
                  : "Ollama rejected the API key on this profile.",
            },
          })
          return
        }
        if (!res.ok) {
          reply.status(502).send({ error: { code: "OLLAMA_ERROR", message: `Ollama returned ${res.status}` } })
          return
        }
        const data = await res.json() as { models?: { name: string }[] }
        const models = (data.models ?? []).map((m) => m.name).filter(Boolean)
        reply.send({ data: models })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not reach Ollama"
        reply.status(502).send({ error: { code: "OLLAMA_UNREACHABLE", message: msg } })
      }
    },
  )

  /** POST /api/show — capabilities, quantization, context, thinking / vision flags. */
  fastify.post(
    "/models/:id/show",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = z.object({
        model:   z.string().min(1).max(200),
        verbose: z.boolean().optional(),
      }).safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }

      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!profile) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({ error: { code: "NOT_SUPPORTED", message: "Model details are only available for Ollama profiles." } })
        return
      }

      const baseUrl = ollamaNativeBase(profile.provider, profile.baseUrl)
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`

      const verbose = parsed.data.verbose ?? false

      try {
        const res = await fetch(`${baseUrl}/api/show`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: parsed.data.model, stream: false, verbose }),
          signal: AbortSignal.timeout(20_000),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          reply.status(502).send({ error: { code: "OLLAMA_ERROR", message: `Ollama returned ${res.status}: ${text.slice(0, 240)}` } })
          return
        }
        const body = await res.json() as Record<string, unknown>
        if (!verbose) {
          delete body.template
          const mi = body.model_info
          if (mi && typeof mi === "object") {
            const keys = Object.keys(mi as object)
            if (keys.length > 64) {
              body.model_info = { _truncated: true, _keyCount: keys.length }
            }
          }
          if (typeof body.license === "string" && body.license.length > 1200) {
            body.license = `${body.license.slice(0, 1200)}\n…`
          }
        }
        reply.send({ data: body })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not reach Ollama"
        reply.status(502).send({ error: { code: "OLLAMA_UNREACHABLE", message: msg } })
      }
    },
  )

  fastify.post(
    "/models/:id/set-default",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const existing = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!existing) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      await fastify.prisma.modelProfile.updateMany({ data: { isDefault: false } })
      const updated = await fastify.prisma.modelProfile.update({ where: { id }, data: { isDefault: true } })
      reply.send({ data: serializeProfile(updated) })
    },
  )
}
