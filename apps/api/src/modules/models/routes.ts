import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_TTS_MODEL,
  GROK_CHAT_MODEL_IDS,
  isGrokChatModelId,
} from "@arciin/shared"

import { assertOllamaCloudApiKey, formatOllamaProviderError } from "@/services/chat/ollama-http"
import {
  availableCloudModelNames,
  invalidateOllamaCloudProbeCache,
  probeOllamaCloudModels,
} from "@/services/chat/ollama-cloud-models"
import { resolveOllamaModelCapabilities } from "@/services/models/ollama-model-capabilities"
import { requireFeature, requireRole } from "@/services/security/auth"

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
  ttsModel:     z.string().max(200).optional().nullable(),
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
  ttsModel?: string | null
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
    ttsModel:     p.ttsModel ?? null,
    isDefault:    p.isDefault,
    isEnabled:    p.isEnabled,
    createdAt:    p.createdAt.toISOString(),
    updatedAt:    p.updatedAt.toISOString(),
  }
}

function normalizeGeminiProfileDefaults<
  T extends {
    provider: string
    defaultModel?: string | null
    ttsModel?: string | null
  },
>(data: T): T {
  if (data.provider !== "gemini") return data
  return {
    ...data,
    defaultModel: data.defaultModel?.trim() || DEFAULT_GEMINI_CHAT_MODEL,
    ttsModel: data.ttsModel?.trim() || DEFAULT_GEMINI_TTS_MODEL,
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
      const normalized = normalizeGeminiProfileDefaults(rest)

      const cloudKeyError = assertOllamaCloudApiKey(normalized.provider, normalized.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      // If setting as default, clear others first
      if (isDefault) {
        await fastify.prisma.modelProfile.updateMany({ data: { isDefault: false } })
      }

      const profile = await fastify.prisma.modelProfile.create({
        data: { ...normalized, isDefault: isDefault ?? false },
      })
      if (profile.provider === "ollama-cloud" && normalized.apiKey) {
        await invalidateOllamaCloudProbeCache(profile.id, fastify.redis)
      }
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

      const provider = (data.provider as string | undefined) ?? existing.provider
      const nextKey =
        typeof data.apiKey === "string" && data.apiKey.trim()
          ? data.apiKey.trim()
          : existing.apiKey

      const cloudKeyError = assertOllamaCloudApiKey(provider, nextKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const updated = await fastify.prisma.modelProfile.update({ where: { id }, data })
      if (
        updated.provider === "ollama-cloud" &&
        typeof data.apiKey === "string" &&
        data.apiKey.trim()
      ) {
        await invalidateOllamaCloudProbeCache(updated.id, fastify.redis)
      }
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

      // xAI is OpenAI-compatible and publishes its catalogue, so the picker can
      // show what the key really has instead of a list hardcoded months ago.
      if (profile.provider === "grok") {
        if (!profile.apiKey) {
          reply.status(400).send({
            error: { code: "MISSING_API_KEY", message: "Add an xAI API key to list models." },
          })
          return
        }
        const base = (profile.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "")
        try {
          const res = await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${profile.apiKey}` },
            signal: AbortSignal.timeout(15_000),
          })
          if (res.status === 401 || res.status === 403) {
            reply.status(502).send({
              error: { code: "XAI_AUTH", message: "xAI rejected the API key on this profile." },
            })
            return
          }
          if (!res.ok) {
            reply.status(502).send({
              error: { code: "XAI_ERROR", message: `xAI returned ${res.status}` },
            })
            return
          }
          const payload = (await res.json()) as { data?: { id?: string }[] }
          const models = (payload.data ?? [])
            .map((m) => m.id)
            .filter((id): id is string => Boolean(id))
            .filter(isGrokChatModelId)
            .sort()
          // An empty result means the key sees no chat model; the static
          // catalogue is more useful there than an empty dropdown.
          reply.send({
            data: { models: models.length > 0 ? models : [...GROK_CHAT_MODEL_IDS], fromCache: false },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not reach xAI"
          reply.status(502).send({ error: { code: "XAI_UNREACHABLE", message: msg } })
        }
        return
      }

      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({ error: { code: "NOT_SUPPORTED", message: "Dynamic model listing is only supported for Ollama." } })
        return
      }

      const baseUrl = ollamaNativeBase(profile.provider, profile.baseUrl)
      const headers: Record<string, string> = {}
      if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`

      const timeoutMs = profile.provider === "ollama-cloud" ? 20_000 : 10_000

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const refresh = (request.query as { refresh?: string }).refresh === "1"

      try {
        if (profile.provider === "ollama-cloud" && profile.apiKey) {
          const { probes, fromCache } = await probeOllamaCloudModels({
            profileId: profile.id,
            baseUrl,
            apiKey: profile.apiKey,
            refresh,
            redis: fastify.redis,
          })
          const available = availableCloudModelNames(probes)
          if (available.length === 0) {
            const keyRejected = probes.some((p) => p.access === "paid")
            if (keyRejected) {
              reply.status(502).send({
                error: {
                  code: "OLLAMA_AUTH",
                  message:
                    "No models available with this API key. Paid models need a paid key from ollama.com/settings/api-keys; free models may be rate-limited.",
                },
              })
              return
            }
            reply.send({ data: { models: [], fromCache } })
            return
          }
          reply.send({ data: { models: available, fromCache } })
          return
        }

        const res = await fetch(`${baseUrl}/api/tags`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status === 401 || res.status === 403) {
          reply.status(502).send({
            error: {
              code: "OLLAMA_AUTH",
              message: "Ollama rejected the API key on this profile.",
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
        reply.send({ data: { models, fromCache: true } })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not reach Ollama"
        reply.status(502).send({ error: { code: "OLLAMA_UNREACHABLE", message: msg } })
      }
    },
  )

  /** Full cloud probe results (available / paid / rate-limited) for Models configure UI. */
  fastify.get(
    "/models/:id/cloud-models",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!profile) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } })
        return
      }
      if (profile.provider !== "ollama-cloud") {
        reply.status(400).send({ error: { code: "NOT_SUPPORTED", message: "Only for Ollama Cloud profiles." } })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const refresh = (request.query as { refresh?: string }).refresh === "1"
      const baseUrl = ollamaNativeBase(profile.provider, profile.baseUrl)

      try {
        const { probes, fromCache } = await probeOllamaCloudModels({
          profileId: profile.id,
          baseUrl,
          apiKey: profile.apiKey!,
          refresh,
          redis: fastify.redis,
        })
        reply.send({ data: { probes, fromCache } })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not probe Ollama Cloud"
        reply.status(502).send({ error: { code: "OLLAMA_PROBE_FAILED", message: msg } })
      }
    },
  )

  /** Batch Ollama /api/show — vision / thinking flags per model (cached). */
  fastify.post(
    "/models/:id/model-capabilities",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = z
        .object({
          models: z.array(z.string().min(1).max(200)).max(80),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() },
        })
        return
      }

      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!profile) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } })
        return
      }
      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({
          error: { code: "NOT_SUPPORTED", message: "Capabilities lookup is only for Ollama profiles." },
        })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      try {
        const { entries, fromCache } = await resolveOllamaModelCapabilities({
          profileId: profile.id,
          baseUrl: ollamaNativeBase(profile.provider, profile.baseUrl),
          apiKey: profile.apiKey,
          models: parsed.data.models,
          redis: fastify.redis,
        })
        reply.send({ data: { entries, fromCache } })
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
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const existing = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!existing) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      await fastify.prisma.modelProfile.updateMany({ data: { isDefault: false } })
      const updated = await fastify.prisma.modelProfile.update({ where: { id }, data: { isDefault: true } })
      reply.send({ data: serializeProfile(updated) })
    },
  )

  /**
   * Free-tier connection test — one short prompt, one short reply.
   * Gated by core.basic_ai (all plans) and restricted to Ollama profiles only:
   * proves the key / local daemon works without unlocking full AI chat (ai.chat).
   */
  fastify.post(
    "/models/:id/test",
    {
      preHandler: [requireRole(["OWNER", "ADMIN", "MEMBER"]), requireFeature("core.basic_ai")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = testSchema.safeParse(request.body ?? {})
      if (!body.success) {
        reply.status(400).send({ error: { code: "INVALID_INPUT", message: "Invalid test input." } })
        return
      }

      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id } })
      if (!profile || !profile.isEnabled) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Model profile not found." } })
        return
      }
      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(403).send({
          error: {
            code: "TEST_OLLAMA_ONLY",
            message: "Connection tests run against Ollama Local or Ollama Cloud profiles only.",
          },
        })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const model = (body.data.model ?? profile.defaultModel ?? "").trim()
      if (!model) {
        reply.status(400).send({
          error: { code: "NO_MODEL", message: "Pick a model for this profile first." },
        })
        return
      }

      const prompt = (body.data.prompt ?? "Say hello from Arciin.").trim().slice(0, 200)
      const base = ollamaNativeBase(profile.provider, profile.baseUrl)
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (profile.apiKey?.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 60_000)
        const res = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: false,
            messages: [{ role: "user", content: prompt }],
            options: { num_predict: 160 },
          }),
        })
        clearTimeout(timeout)

        if (!res.ok) {
          const text = await res.text().catch(() => "")
          reply.status(502).send({
            error: {
              code: "TEST_FAILED",
              message: formatOllamaProviderError(res.status, text, {
                hasApiKey: Boolean(profile.apiKey),
                isCloud: profile.provider === "ollama-cloud",
              }),
            },
          })
          return
        }

        const json = (await res.json().catch(() => null)) as
          | { message?: { content?: string } }
          | null
        const replyText = json?.message?.content?.trim()
        if (!replyText) {
          reply.status(502).send({
            error: {
              code: "TEST_EMPTY",
              message: "The model returned an empty reply. Check that the model is installed and try again.",
            },
          })
          return
        }

        reply.send({ data: { model, reply: replyText.slice(0, 2000) } })
      } catch (err) {
        const message =
          err instanceof Error && err.name === "AbortError"
            ? "Test timed out after 60s. Check that Ollama is running and the model is loaded."
            : err instanceof Error
              ? err.message
              : "Could not reach Ollama."
        reply.status(502).send({ error: { code: "TEST_UNREACHABLE", message } })
      }
    },
  )
}

const testSchema = z.object({
  prompt: z.string().max(400).optional(),
  model: z.string().max(200).optional(),
})
