import fs from "node:fs/promises"

import {
  applyPrivacyToChatContext,
  buildAiSecuritySystemAppend,
  buildAiSystemAppend,
  isPasswordRelatedConversation,
  isVaultListingQuery,
  recentUserVaultContextText,
  parseAiConfig,
  parseAiSecurityConfig,
  sanitizeOutboundChatText,
  isSelfHostedLanOrigin,
} from "@arciin/shared"
import {
  isCloudChatProvider,
  resolveLocalOllamaProfile,
} from "@/services/chat/resolve-local-ollama-profile"
import { getPasswordVaultAiSnapshot } from "@/services/password-vault/vault-for-ai"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"

import { apiConfig } from "@/config"
import { assertOllamaCloudApiKey } from "@/services/chat/ollama-http"
import { streamOllamaWithArciinTools } from "@/services/chat/ollama-chat-with-tools"
import { organizeImagesLibrary } from "@/services/chat/organize-images-library"
import {
  DEFAULT_SCAN_LIMIT,
  loadImageCandidatesForVision,
  normalizeVisionSearchQuery,
  loadSingleImageForVision,
  visionSearchLibraryImages,
  visionSuggestAssetRename,
} from "@/services/chat/vision-library"
import { requireRole } from "@/services/security/auth"

const SSE_DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost",
])

/** @fastify/cors does not attach to `reply.raw` — set these on SSE responses for cross-origin dev. */
function corsHeadersForSse(request: FastifyRequest): Record<string, string> {
  const origin = request.headers.origin
  if (!origin) return {}
  const allowed =
    !apiConfig.isProduction ||
    origin === apiConfig.ARCIIN_PUBLIC_URL ||
    SSE_DEV_ORIGINS.has(origin) ||
    isSelfHostedLanOrigin(origin)
  if (!allowed) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  }
}

const messageSchema = z.object({
  role:    z.enum(["user", "assistant", "system"]),
  content: z.string(),
  /** Base64-encoded image bytes (Ollama vision). Only the latest user message should include these. */
  images: z.array(z.string().min(1)).max(4).optional(),
})

const chatSchema = z.object({
  profileId: z.string().optional(),
  model:     z.string().max(200).optional(),
  messages:  z.array(messageSchema).min(1),
})

type ChatMessageIn = z.infer<typeof messageSchema>

function messagesTextOnly(messages: ChatMessageIn[]): { role: string; content: string }[] {
  return messages.map(({ role, content }) => ({ role, content }))
}

function messagesForOllama(messages: ChatMessageIn[]): Array<{ role: string; content: string; images?: string[] }> {
  return messages.map((m) => {
    if (m.role === "system") return { role: m.role, content: m.content }
    if (m.images?.length) return { role: m.role, content: m.content, images: m.images }
    return { role: m.role, content: m.content }
  })
}

const OLLAMA_PROVIDERS = new Set(["ollama", "ollama-local", "ollama-cloud"])

function sanitizeMessagesForProvider<T extends { role: string; content: string }>(
  messages: T[],
  security: ReturnType<typeof parseAiSecurityConfig>,
): T[] {
  return messages.map((m) => ({
    ...m,
    content: sanitizeOutboundChatText(m.content, security, m.role),
  }))
}

function appendSystemInstructions<T extends { role: string; content: string }>(
  messages: T[],
  append: string,
): T[] {
  const trimmed = append.trim()
  if (!trimmed) return messages
  const out = [...messages]
  const sysIdx = out.findIndex((m) => m.role === "system")
  if (sysIdx >= 0) {
    out[sysIdx] = { ...out[sysIdx]!, content: out[sysIdx]!.content + append }
  } else {
    out.unshift({ role: "system", content: trimmed } as T)
  }
  return out
}

// Base URLs for OpenAI-compatible providers
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai:   "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  grok:     "https://api.x.ai/v1",
  gemini:   "https://generativelanguage.googleapis.com/v1beta/openai",
  qwen:     "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
}

function getBaseUrl(provider: string, profileBaseUrl: string | null): string {
  if (profileBaseUrl) return profileBaseUrl
  return PROVIDER_BASE_URLS[provider] ?? ""
}

// For Ollama native API: strip any /v1 suffix to get the root host
function getOllamaNativeBase(provider: string, profileBaseUrl: string | null): string {
  const raw = profileBaseUrl ?? (provider === "ollama-cloud" ? "https://ollama.com" : "http://localhost:11434")
  return raw.replace(/\/v1\/?$/, "").replace(/\/$/, "")
}

const conversationSchema = z.object({
  title:     z.string().max(200),
  profileId: z.string().optional(),
})

const saveMessagesSchema = z.object({
  conversationId: z.string(),
  messages: z.array(z.object({
    role:         z.enum(["user", "assistant", "system"]),
    content:      z.string(),
    inputTokens:  z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    totalTokens:  z.number().int().optional(),
  })),
})

export async function registerChatRoutes(fastify: FastifyInstance) {
  // ── Instance context for AI ─────────────────────────────────────────────────
  fastify.get(
    "/chat/context",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (_request, reply) => {
      const [libraries, assetCounts, storageAgg, recentUpload, appDbRows] = await Promise.all([
        fastify.prisma.library.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            kind: true,
            _count: { select: { assets: { where: { deletedAt: null } } } },
          },
        }),
        fastify.prisma.asset.groupBy({
          by: ["mediaType"],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        fastify.prisma.storageObject.aggregate({ _sum: { sizeBytes: true } }),
        fastify.prisma.asset.findFirst({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        fastify.prisma.appDatabase.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            createdAt: true,
            _count: {
              select: {
                folders: { where: { deletedAt: null } },
              },
            },
          },
        }),
      ])

      const libraryIds = libraries.map((l) => l.id)
      const slugByLibraryId = new Map(libraries.map((l) => [l.id, l.slug]))
      const folderRows =
        libraryIds.length === 0
          ? []
          : await fastify.prisma.folder.findMany({
              where: { deletedAt: null, libraryId: { in: libraryIds } },
              orderBy: [{ libraryId: "asc" }, { pathCache: "asc" }],
              take: 500,
              select: {
                id: true,
                name: true,
                pathCache: true,
                libraryId: true,
                _count: { select: { assets: { where: { deletedAt: null } } } },
              },
            })


      const folders = folderRows.map((f) => ({
        id: f.id,
        libraryId: f.libraryId,
        librarySlug: slugByLibraryId.get(f.libraryId) ?? "",
        name: f.name,
        pathCache: f.pathCache,
        assetCount: f._count.assets,
      }))

      const appDatabases = appDbRows.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        description: d.description ?? null,
        tableCount: d._count.folders,
        createdAt: d.createdAt.toISOString(),
      }))

      const totalBytes = BigInt(storageAgg._sum.sizeBytes ?? 0)
      const gb = Number(totalBytes) / 1_073_741_824

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const cfg = (instance?.aiConfig as Record<string, unknown> | null) ?? {}
      const security = parseAiSecurityConfig(cfg.security)

      const rawContext = {
        libraries: libraries.map((l) => ({
          id: l.id,
          slug: l.slug,
          name: l.name,
          kind: l.kind,
          count: l._count.assets,
        })),
        folders,
        appDatabases,
        byMediaType: assetCounts.map((r) => ({ type: r.mediaType, count: r._count._all })),
        storageGb: Math.round(gb * 10) / 10,
        lastUploadAt: recentUpload?.createdAt ?? null,
      }

      const data = applyPrivacyToChatContext(rawContext, security)
      const vaultSnapshot = await getPasswordVaultAiSnapshot(fastify.prisma, {
        listAll: true,
      })

      reply.send({
        data: {
          ...data,
          lastUploadAt: data.lastUploadAt instanceof Date ? data.lastUploadAt.toISOString() : data.lastUploadAt,
          passwordVaultLine: vaultSnapshot.contextLine,
        },
      })
    },
  )

  /** Recent IMAGE assets as base64 for Ollama `/api/chat` `images[]` (vision). */
  fastify.get(
    "/chat/vision-recent",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const q = z.object({ limit: z.coerce.number().int().min(1).max(3).default(1) }).parse(request.query ?? {})

      const candidates = await fastify.prisma.asset.findMany({
        where: { deletedAt: null, mediaType: "IMAGE", status: "READY" },
        orderBy: { createdAt: "desc" },
        take: 24,
        include: { storageObject: true },
      })

      const MAX_BYTES = 4 * 1024 * 1024
      const images: string[] = []

      for (const asset of candidates) {
        if (images.length >= q.limit) break
        const p = asset.storageObject?.physicalPath
        if (!p) continue
        try {
          const stat = await fs.stat(p)
          if (stat.size > MAX_BYTES) continue
          const buf = await fs.readFile(p)
          images.push(buf.toString("base64"))
        } catch {
          // unreadable / missing file
        }
      }

      reply.send({ data: { images } })
    },
  )

  /** Scan recent library images with a vision model and return matches for a text query. */
  fastify.post(
    "/chat/vision-search",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const parsed = z.object({
        query:     z.string().min(1).max(500),
        profileId: z.string(),
        model:     z.string().max(200).optional(),
        maxResults: z.number().int().min(1).max(9).optional(),
      }).safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid vision search payload.", details: parsed.error.flatten() } })
        return
      }

      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id: parsed.data.profileId } })
      if (!profile) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Model profile not found." } }); return }
      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({ error: { code: "NOT_SUPPORTED", message: "Vision search requires an Ollama profile." } })
        return
      }

      const model = parsed.data.model || profile.defaultModel || ""
      if (!model) {
        reply.status(400).send({ error: { code: "NO_MODEL", message: "No model selected." } })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const baseUrl = getOllamaNativeBase(profile.provider, profile.baseUrl)
      const searchQuery = normalizeVisionSearchQuery(parsed.data.query)
      const pageSize = Math.min(48, Math.max(DEFAULT_SCAN_LIMIT, parsed.data.maxResults ?? 3))
      const maxResults = parsed.data.maxResults ?? 3
      const maxPages = 3

      let scanned = 0
      let dbSkip = 0
      const matches: Awaited<ReturnType<typeof visionSearchLibraryImages>> = []

      for (let page = 0; page < maxPages && matches.length < maxResults; page++) {
        const candidates = await loadImageCandidatesForVision(
          fastify.prisma,
          instance?.storageRoot,
          pageSize,
          { queryHint: page === 0 ? searchQuery : undefined, skip: dbSkip },
        )
        if (candidates.length === 0) break

        scanned += candidates.length
        dbSkip += pageSize * 2

        const pageMatches = await visionSearchLibraryImages({
          baseUrl,
          model,
          apiKey: profile.apiKey,
          query: searchQuery,
          candidates,
          maxResults,
        })
        for (const m of pageMatches) {
          if (!matches.some((x) => x.assetId === m.assetId)) matches.push(m)
        }
        if (matches.length > 0 && matches[0]!.confidence >= 0.8) break
      }

      matches.sort((a, b) => b.confidence - a.confidence)

      reply.send({
        data: {
          query: searchQuery,
          scanned,
          matches: matches.slice(0, maxResults),
        },
      })
    },
  )

  /** Suggest title/filename from vision for one library image (optional assetId, else most recent). */
  fastify.post(
    "/chat/vision-suggest-rename",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const parsed = z.object({
        profileId: z.string(),
        model:     z.string().max(200).optional(),
        assetId:   z.string().optional(),
      }).safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid vision rename payload.", details: parsed.error.flatten() } })
        return
      }

      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id: parsed.data.profileId } })
      if (!profile) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Model profile not found." } }); return }
      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({ error: { code: "NOT_SUPPORTED", message: "Vision rename requires an Ollama profile." } })
        return
      }

      const model = parsed.data.model || profile.defaultModel || ""
      if (!model) {
        reply.status(400).send({ error: { code: "NO_MODEL", message: "No model selected." } })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const baseUrl = getOllamaNativeBase(profile.provider, profile.baseUrl)

      const candidate = parsed.data.assetId
        ? await loadSingleImageForVision(fastify.prisma, instance?.storageRoot, parsed.data.assetId)
        : (await loadImageCandidatesForVision(fastify.prisma, instance?.storageRoot, 1))[0] ?? null

      if (!candidate) {
        reply.status(404).send({ error: { code: "NO_IMAGE", message: "No readable image found." } })
        return
      }

      const suggestion = await visionSuggestAssetRename({
        baseUrl,
        model,
        apiKey: profile.apiKey,
        candidate,
      })

      reply.send({
        data: {
          assetId: candidate.assetId,
          suggestedTitle: suggestion.title,
          suggestedFilename: suggestion.filename,
          description: suggestion.description,
        },
      })
    },
  )

  /** Classify images in the Images library into folders (vision + create/move). */
  fastify.post(
    "/chat/organize-images",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const parsed = z
        .object({
          profileId: z.string(),
          model: z.string().max(200).optional(),
          maxAssets: z.number().int().min(1).max(30).optional(),
        })
        .safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid organize images payload.", details: parsed.error.flatten() } })
        return
      }

      const profile = await fastify.prisma.modelProfile.findUnique({ where: { id: parsed.data.profileId } })
      if (!profile) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Model profile not found." } })
        return
      }
      if (!OLLAMA_PROVIDERS.has(profile.provider)) {
        reply.status(400).send({
          error: { code: "NOT_SUPPORTED", message: "Image organization requires an Ollama vision profile." },
        })
        return
      }

      const model = parsed.data.model || profile.defaultModel || ""
      if (!model) {
        reply.status(400).send({ error: { code: "NO_MODEL", message: "No model selected." } })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const baseUrl = getOllamaNativeBase(profile.provider, profile.baseUrl)

      try {
        const result = await organizeImagesLibrary({
          prisma: fastify.prisma,
          storageRoot: instance?.storageRoot,
          baseUrl,
          model,
          apiKey: profile.apiKey,
          userId: request.auth!.user.id,
          maxAssets: parsed.data.maxAssets,
          publishRealtimeEvent: fastify.publishRealtimeEvent,
        })
        reply.send({ data: result })
      } catch (err) {
        reply.status(500).send({
          error: {
            code: "ORGANIZE_FAILED",
            message: err instanceof Error ? err.message : "Image organization failed.",
          },
        })
      }
    },
  )

  // ── List conversations ───────────────────────────────────────────────────────
  fastify.get(
    "/chat/conversations",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user = request.auth!.user
      const convos = await fastify.prisma.chatConversation.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true, title: true, createdAt: true, updatedAt: true,
          profile: { select: { id: true, displayName: true, provider: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
        },
      })
      reply.send({ data: convos })
    },
  )

  // ── Get single conversation with messages ────────────────────────────────────
  fastify.get(
    "/chat/conversations/:id",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user  = request.auth!.user
      const { id } = request.params as { id: string }
      const convo = await fastify.prisma.chatConversation.findFirst({
        where: { id, userId: user.id },
        include: {
          profile:  { select: { id: true, displayName: true, provider: true } },
          messages: { orderBy: { createdAt: "asc" } },
        },
      })
      if (!convo) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      reply.send({ data: convo })
    },
  )

  // ── Create conversation ──────────────────────────────────────────────────────
  fastify.post(
    "/chat/conversations",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user   = request.auth!.user
      const parsed = conversationSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }
      const convo = await fastify.prisma.chatConversation.create({
        data: { userId: user.id, title: parsed.data.title, profileId: parsed.data.profileId ?? null },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      })
      reply.status(201).send({ data: convo })
    },
  )

  // ── Append messages to conversation ─────────────────────────────────────────
  fastify.post(
    "/chat/conversations/messages",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user   = request.auth!.user
      const parsed = saveMessagesSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }
      const convo = await fastify.prisma.chatConversation.findFirst({
        where: { id: parsed.data.conversationId, userId: user.id },
      })
      if (!convo) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }

      const created = await fastify.prisma.$transaction(async (tx) => {
        const rows = await Promise.all(
          parsed.data.messages.map((m) =>
            tx.chatMessage.create({
              data: {
                conversationId: convo.id,
                role: m.role,
                content: m.content,
                inputTokens: m.inputTokens ?? null,
                outputTokens: m.outputTokens ?? null,
                totalTokens: m.totalTokens ?? null,
              },
              select: {
                id: true,
                role: true,
                feedbackRating: true,
                createdAt: true,
              },
            }),
          ),
        )
        await tx.chatConversation.update({
          where: { id: convo.id },
          data: { updatedAt: new Date() },
        })
        return rows
      })
      reply.send({ data: { messages: created } })
    },
  )

  const messageFeedbackSchema = z.object({
    rating: z.enum(["LIKE", "DISLIKE"]).nullable(),
  })

  const updateMessageSchema = z.object({
    content: z.string().min(1),
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    totalTokens: z.number().int().optional(),
  })

  fastify.patch(
    "/chat/messages/:id",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user = request.auth!.user
      const { id } = request.params as { id: string }
      const parsed = updateMessageSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }

      const existing = await fastify.prisma.chatMessage.findFirst({
        where: { id, conversation: { userId: user.id } },
        select: { id: true, role: true },
      })
      if (!existing) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } })
        return
      }
      if (existing.role !== "assistant") {
        reply.status(400).send({ error: { code: "INVALID_ROLE", message: "Only assistant messages can be updated" } })
        return
      }

      const updated = await fastify.prisma.chatMessage.update({
        where: { id },
        data: {
          content: parsed.data.content,
          inputTokens: parsed.data.inputTokens ?? null,
          outputTokens: parsed.data.outputTokens ?? null,
          totalTokens: parsed.data.totalTokens ?? null,
        },
        select: {
          id: true,
          role: true,
          content: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          feedbackRating: true,
          feedbackAt: true,
          createdAt: true,
        },
      })
      reply.send({ data: updated })
    },
  )

  fastify.patch(
    "/chat/messages/:id/feedback",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user = request.auth!.user
      const { id } = request.params as { id: string }
      const parsed = messageFeedbackSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }

      const existing = await fastify.prisma.chatMessage.findFirst({
        where: {
          id,
          conversation: { userId: user.id },
        },
        select: { id: true, role: true },
      })
      if (!existing) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } })
        return
      }
      if (existing.role !== "assistant") {
        reply.status(400).send({ error: { code: "INVALID_ROLE", message: "Only assistant messages can receive feedback" } })
        return
      }

      const rating = parsed.data.rating
      const updated = await fastify.prisma.chatMessage.update({
        where: { id },
        data: {
          feedbackRating: rating,
          feedbackAt: rating ? new Date() : null,
        },
        select: {
          id: true,
          feedbackRating: true,
          feedbackAt: true,
        },
      })
      reply.send({ data: updated })
    },
  )

  // ── Delete conversation ──────────────────────────────────────────────────────
  fastify.delete(
    "/chat/conversations/:id",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user  = request.auth!.user
      const { id } = request.params as { id: string }
      const convo = await fastify.prisma.chatConversation.findFirst({ where: { id, userId: user.id } })
      if (!convo) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      await fastify.prisma.chatConversation.delete({ where: { id } })
      reply.send({ data: { success: true } })
    },
  )

  // ── Rename conversation ──────────────────────────────────────────────────────
  fastify.patch(
    "/chat/conversations/:id",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user   = request.auth!.user
      const { id } = request.params as { id: string }
      const parsedTitle = z.object({ title: z.string().trim().min(1).max(200) }).safeParse(request.body)
      if (!parsedTitle.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "A non-empty title (max 200 chars) is required.", details: parsedTitle.error.flatten() } })
        return
      }
      const { title } = parsedTitle.data
      const convo = await fastify.prisma.chatConversation.findFirst({ where: { id, userId: user.id } })
      if (!convo) { reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }); return }
      const updated = await fastify.prisma.chatConversation.update({
        where: { id },
        data:  { title },
        select: { id: true, title: true },
      })
      reply.send({ data: updated })
    },
  )

  fastify.post(
    "/chat",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
      bodyLimit: 32 * 1024 * 1024,
    },
    async (request, reply) => {
      const parsed = chatSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }

      const { profileId, model: modelOverride, messages } = parsed.data

      let profile = profileId
        ? await fastify.prisma.modelProfile.findUnique({ where: { id: profileId } })
        : await fastify.prisma.modelProfile.findFirst({ where: { isDefault: true, isEnabled: true } })
          ?? await fastify.prisma.modelProfile.findFirst({ where: { isEnabled: true } })

      if (!profile) {
        reply.status(400).send({ error: { code: "NO_MODEL", message: "No model profile configured. Add one under Models." } })
        return
      }

      const instanceForSecurity = await fastify.prisma.instanceConfig.findFirst()
      const securityEarly = parseAiSecurityConfig(
        (instanceForSecurity?.aiConfig as Record<string, unknown> | null)?.security,
      )
      const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
      const vaultConversationText = recentUserVaultContextText(messages)
      const passwordRelatedTurn = isPasswordRelatedConversation(messages)
      if (
        securityEarly.passwordQueriesLocalAiOnly &&
        passwordRelatedTurn &&
        isCloudChatProvider(profile.provider)
      ) {
        const localProfile = await resolveLocalOllamaProfile(fastify.prisma)
        if (!localProfile) {
          reply.status(400).send({
            error: {
              code: "LOCAL_MODEL_REQUIRED",
              message:
                "Password-related questions are restricted to local AI. Enable an Ollama profile under Models.",
            },
          })
          return
        }
        profile = localProfile
      }

      // Use requested model override, then profile default, then empty string
      const model = modelOverride || profile.defaultModel || ""
      const baseUrl = getBaseUrl(profile.provider, profile.baseUrl)

      if (!baseUrl) {
        reply.status(400).send({ error: { code: "NO_BASE_URL", message: `Cannot resolve base URL for provider: ${profile.provider}` } })
        return
      }

      const cloudKeyError = assertOllamaCloudApiKey(profile.provider, profile.apiKey)
      if (cloudKeyError) {
        reply.status(400).send({ error: cloudKeyError })
        return
      }

      const raw = reply.raw
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        ...corsHeadersForSse(request),
      })

      try {
        const instance = await fastify.prisma.instanceConfig.findFirst()
        const aiCfg = (instance?.aiConfig as Record<string, unknown> | null) ?? {}
        const aiSettings = parseAiConfig(aiCfg)
        const security = parseAiSecurityConfig(aiCfg.security)
        const vaultSnapshot = await getPasswordVaultAiSnapshot(fastify.prisma, {
          queryHint: passwordRelatedTurn ? vaultConversationText : undefined,
          listAll:
            passwordRelatedTurn &&
            (isVaultListingQuery(vaultConversationText) ||
              isVaultListingQuery(lastUserText)),
        })
        let systemAppend =
          buildAiSystemAppend(aiSettings) + buildAiSecuritySystemAppend(security)
        if (vaultSnapshot.contextLine) {
          systemAppend += `\n\n--- Password vault (redacted for assistant) ---\n${vaultSnapshot.contextLine}\n---`
        }

        const safeText = sanitizeMessagesForProvider(messagesTextOnly(messages), security)

        if (profile.provider === "anthropic") {
          const anthropicMessages = appendSystemInstructions(safeText, systemAppend)
          await streamAnthropic({ raw, apiKey: profile.apiKey!, model, messages: anthropicMessages })
        } else if (OLLAMA_PROVIDERS.has(profile.provider)) {
          const nativeBase = getOllamaNativeBase(profile.provider, profile.baseUrl)
          const ollamaMessages = appendSystemInstructions(
            sanitizeMessagesForProvider(messagesForOllama(messages), security),
            systemAppend,
          )
          await streamOllamaWithArciinTools({
            raw,
            baseUrl: nativeBase,
            model,
            apiKey: profile.apiKey,
            messages: ollamaMessages,
            toolCtx: {
              prisma: fastify.prisma,
              storageRoot: instance?.storageRoot ?? null,
              baseUrl: nativeBase,
              model,
              apiKey: profile.apiKey,
              userId: request.auth!.user.id,
              libraryToolAccess: security.libraryToolAccess,
              publishRealtimeEvent: fastify.publishRealtimeEvent,
            },
            ai: { agent: aiSettings.agent, autonomy: aiSettings.autonomy },
            security: {
              libraryToolAccess: security.libraryToolAccess,
              readOnlyTools: security.readOnlyTools,
              requireToolApproval: security.requireToolApproval,
            },
          })
        } else {
          const compatMessages = appendSystemInstructions(safeText, systemAppend)
          await streamOpenAICompat({ raw, baseUrl, apiKey: profile.apiKey ?? "", model, messages: compatMessages })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Provider error"
        raw.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
      } finally {
        raw.write("data: [DONE]\n\n")
        raw.end()
      }
    },
  )

  fastify.get(
    "/chat/profiles",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (_request, reply) => {
      const profiles = await fastify.prisma.modelProfile.findMany({
        where: { isEnabled: true },
        select: { id: true, provider: true, displayName: true, defaultModel: true, isDefault: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
      reply.send({ data: profiles })
    },
  )

  const chatSelectionSchema = z.object({
    profileId: z.string().cuid(),
    model: z.string().max(200).optional(),
  })

  fastify.get(
    "/chat/selection",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.auth!.user.id },
        select: { preferences: true },
      })
      const root =
        user?.preferences && typeof user.preferences === "object" && !Array.isArray(user.preferences)
          ? (user.preferences as Record<string, unknown>)
          : null
      const chat = root?.chat
      if (!chat || typeof chat !== "object") {
        reply.send({ data: null })
        return
      }
      const profileId = (chat as Record<string, unknown>).profileId
      const model = (chat as Record<string, unknown>).model
      if (typeof profileId !== "string" || !profileId) {
        reply.send({ data: null })
        return
      }
      reply.send({
        data: {
          profileId,
          model: typeof model === "string" ? model : "",
        },
      })
    },
  )

  const chatSelectionPreHandler = requireRole(["OWNER", "ADMIN", "MEMBER"])

  async function handleChatSelectionSave(
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const parsed = chatSelectionSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid chat selection.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const profile = await fastify.prisma.modelProfile.findFirst({
      where: { id: parsed.data.profileId, isEnabled: true },
    })
    if (!profile) {
      reply.status(400).send({
        error: { code: "INVALID_PROFILE", message: "Model profile not found or disabled." },
      })
      return
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: request.auth!.user.id },
      select: { preferences: true },
    })
    const root =
      user?.preferences && typeof user.preferences === "object" && !Array.isArray(user.preferences)
        ? { ...(user.preferences as Record<string, unknown>) }
        : {}

    const selection = {
      profileId: parsed.data.profileId,
      model: parsed.data.model?.trim() ?? profile.defaultModel ?? "",
    }
    root.chat = selection

    await fastify.prisma.user.update({
      where: { id: request.auth!.user.id },
      data: { preferences: root as import("@prisma/client").Prisma.InputJsonValue },
    })

    reply.send({ data: selection })
  }

  fastify.put("/chat/selection", { preHandler: chatSelectionPreHandler }, handleChatSelectionSave)

  /** POST alias — iOS PWA often fails CORS preflight on PUT. */
  fastify.post("/chat/selection", { preHandler: chatSelectionPreHandler }, handleChatSelectionSave)
}

// ── Ollama native streaming (/api/chat with think:true) ───────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function streamOllamaNative({
  raw, baseUrl, model, messages,
}: {
  raw: import("http").ServerResponse
  baseUrl: string
  model: string
  messages: Array<{ role: string; content: string; images?: string[] }>
}) {
  /** GPT-OSS ignores boolean think; Ollama expects low | medium | high. */
  const think: boolean | string = /gpt-oss/i.test(model) ? "medium" : true

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, think }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Provider error ${res.status}: ${text.slice(0, 200)}`)
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  /** Ollama may emit cumulative `message.*` strings per chunk — forward only the delta to the browser. */
  let prevThinkingFull = ""
  let prevContentFull = ""

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    if (done) buffer += decoder.decode()

    const lines = buffer.split("\n")
    buffer = done ? "" : (lines.pop() ?? "")

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const json = JSON.parse(trimmed) as {
          message?: { content?: string; thinking?: string; thought?: string }
          done?: boolean
          prompt_eval_count?: number
          eval_count?: number
        }

        const m = json.message ?? {}
        const thinkingFull =
          (typeof m.thinking === "string" ? m.thinking : "") ||
          (typeof m.thought === "string" ? m.thought : "")
        const contentFull = typeof m.content === "string" ? m.content : ""

        if (thinkingFull && thinkingFull !== prevThinkingFull) {
          const delta = thinkingFull.startsWith(prevThinkingFull)
            ? thinkingFull.slice(prevThinkingFull.length)
            : thinkingFull
          prevThinkingFull = thinkingFull
          if (delta) raw.write(`data: ${JSON.stringify({ thinking: delta })}\n\n`)
        }
        if (contentFull && contentFull !== prevContentFull) {
          const delta = contentFull.startsWith(prevContentFull)
            ? contentFull.slice(prevContentFull.length)
            : contentFull
          prevContentFull = contentFull
          if (delta) raw.write(`data: ${JSON.stringify({ text: delta })}\n\n`)
        }

        if (json.done) {
          const inputTokens  = json.prompt_eval_count ?? 0
          const outputTokens = json.eval_count ?? 0
          if (inputTokens > 0 || outputTokens > 0) {
            raw.write(`data: ${JSON.stringify({ usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } })}\n\n`)
          }
          return
        }
      } catch {
        // skip malformed lines
      }
    }

    if (done) break
  }
}

// ── OpenAI-compatible streaming ────────────────────────────────────────────────

async function streamOpenAICompat({
  raw, baseUrl, apiKey, model, messages,
}: {
  raw: import("http").ServerResponse
  baseUrl: string
  apiKey: string
  model: string
  messages: { role: string; content: string }[]
}) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Provider error ${res.status}: ${text.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]") return

      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string; thinking?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        }
        const delta    = json.choices?.[0]?.delta
        const thinking = delta?.thinking  // Ollama 0.6+ dedicated thinking field
        const text     = delta?.content

        if (thinking) raw.write(`data: ${JSON.stringify({ thinking })}\n\n`)
        if (text)     raw.write(`data: ${JSON.stringify({ text })}\n\n`)

        if (json.usage?.total_tokens) {
          raw.write(`data: ${JSON.stringify({
            usage: {
              inputTokens:  json.usage.prompt_tokens     ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
              totalTokens:  json.usage.total_tokens      ?? 0,
            },
          })}\n\n`)
        }
      } catch {
        // skip malformed chunks
      }
    }
  }
}

// ── Anthropic streaming ────────────────────────────────────────────────────────

async function streamAnthropic({
  raw, apiKey, model, messages,
}: {
  raw: import("http").ServerResponse
  apiKey: string
  model: string
  messages: { role: string; content: string }[]
}) {
  const systemMsg = messages.find((m) => m.role === "system")
  const userMsgs  = messages.filter((m) => m.role !== "system")

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: userMsgs,
    stream: true,
  }
  if (systemMsg) body.system = systemMsg.content

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let inputTokens = 0
  let outputTokens = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()

      try {
        const json = JSON.parse(payload) as {
          type?: string
          delta?: { type?: string; text?: string }
          message?: { usage?: { input_tokens?: number } }
          usage?: { output_tokens?: number }
        }

        if (json.type === "message_start") {
          inputTokens = json.message?.usage?.input_tokens ?? 0
        }
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          raw.write(`data: ${JSON.stringify({ text: json.delta.text })}\n\n`)
        }
        if (json.type === "message_delta") {
          outputTokens = json.usage?.output_tokens ?? outputTokens
        }
        if (json.type === "message_stop") {
          if (inputTokens > 0 || outputTokens > 0) {
            raw.write(`data: ${JSON.stringify({
              usage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            })}\n\n`)
          }
          return
        }
      } catch {
        // skip
      }
    }
  }
}
