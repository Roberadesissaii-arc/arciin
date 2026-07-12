import fs from "node:fs/promises"

import {
  applyPrivacyToChatContext,
  buildAiSecuritySystemAppend,
  buildAiSystemAppend,
  isCodeFilename,
  isPasswordRelatedConversation,
  isVaultListingQuery,
  recentUserVaultContextText,
  parseAiConfig,
  parseAiSecurityConfig,
  sanitizeOutboundChatText,
} from "@arciin/shared"
import {
  isCloudChatProvider,
  resolveLocalOllamaProfile,
} from "@/services/chat/resolve-local-ollama-profile"
import { getPasswordVaultAiSnapshot } from "@/services/password-vault/vault-for-ai"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { assertOllamaCloudApiKey } from "@/services/chat/ollama-http"
import { executeArciinChatTool } from "@/services/chat/arciin-chat-tools"
import {
  DEFAULT_GEMINI_TTS_VOICE,
  synthesizeGeminiTts,
} from "@/services/chat/gemini-tts"
import { resolveGeminiTtsConfig } from "@/services/chat/resolve-gemini-tts-key"
import { streamOllamaWithArciinTools } from "@/services/chat/ollama-chat-with-tools"
import { flushSseResponse, writeSseEvent } from "@/services/chat/sse-stream"
import { buildFocusAssetSystemAppend } from "@/services/chat/focus-asset-context"
import { resolveChatModelName } from "@/services/chat/resolve-chat-model"
import { buildSyntheticReadTextAssetArgsFromUser } from "@/services/chat/read-text-asset-synthetic"
import { organizeImagesLibrary } from "@/services/chat/organize-images-library"
import {
  DEFAULT_SCAN_LIMIT,
  loadImageCandidatesForVision,
  normalizeVisionSearchQuery,
  loadSingleImageForVision,
  visionSearchLibraryImages,
  visionSuggestAssetRename,
} from "@/services/chat/vision-library"
import { requireFeature, requireRole } from "@/services/security/auth"

import { corsHeadersForRequestOrigin } from "@/plugins/cors-origins"

const messageSchema = z.object({
  role:    z.enum(["user", "assistant", "system"]),
  content: z.string(),
  /** Base64-encoded image bytes (vision). Only the latest user message should include these. */
  images: z.array(z.string().min(1)).max(4).optional(),
})

const focusAssetSchema = z.object({
  assetId: z.string().min(1),
  currentPage: z.number().int().min(1).optional(),
})

const chatSchema = z.object({
  profileId: z.string().optional(),
  model:     z.string().max(200).optional(),
  messages:  z.array(messageSchema).min(1),
  focusAsset: focusAssetSchema.optional(),
})

type ChatMessageIn = z.infer<typeof messageSchema>

function messagesTextOnly(messages: ChatMessageIn[]): { role: string; content: string }[] {
  return messages
    .map(({ role, content }) => ({ role, content }))
    .filter((m) => m.role !== "assistant" || m.content.trim().length > 0)
}

function messagesForOllama(messages: ChatMessageIn[]): Array<{ role: string; content: string; images?: string[] }> {
  return messages
    .filter((m) => m.role !== "assistant" || m.content.trim().length > 0)
    .map((m) => {
      if (m.role === "system") return { role: m.role, content: m.content }
      if (m.images?.length) return { role: m.role, content: m.content, images: m.images }
      return { role: m.role, content: m.content }
    })
}

type OpenAICompatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

type OpenAICompatMessage = {
  role: string
  content: string | OpenAICompatContentPart[]
}

function mimeFromBase64(b64: string): string {
  try {
    const bytes = Buffer.from(b64.slice(0, 32), "base64")
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png"
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif"
    if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp"
  } catch {
    /* ignore */
  }
  return "image/jpeg"
}

/** OpenAI-compatible multimodal messages (Gemini, GPT-4o, etc.). */
function messagesForOpenAICompat(messages: ChatMessageIn[]): OpenAICompatMessage[] {
  return messages
    .filter((m) => m.role !== "assistant" || m.content.trim().length > 0)
    .map((m) => {
      if (m.role === "system") return { role: m.role, content: m.content }
      if (m.images?.length) {
        const parts: OpenAICompatContentPart[] = []
        if (m.content.trim()) parts.push({ type: "text", text: m.content })
        for (const b64 of m.images) {
          const mime = mimeFromBase64(b64)
          parts.push({
            type: "image_url",
            image_url: { url: `data:${mime};base64,${b64}` },
          })
        }
        return { role: m.role, content: parts }
      }
      return { role: m.role, content: m.content }
    })
}

function openAICompatUsesVision(messages: ChatMessageIn[]): boolean {
  return messages.some((m) => (m.images?.length ?? 0) > 0)
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

function sanitizeOpenAICompatMessages(
  messages: OpenAICompatMessage[],
  security: ReturnType<typeof parseAiSecurityConfig>,
): OpenAICompatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { ...m, content: sanitizeOutboundChatText(m.content, security, m.role) }
    }
    return {
      ...m,
      content: m.content.map((part) =>
        part.type === "text"
          ? { ...part, text: sanitizeOutboundChatText(part.text, security, m.role) }
          : part,
      ),
    }
  })
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

function appendSystemInstructionsOpenAI(
  messages: OpenAICompatMessage[],
  append: string,
): OpenAICompatMessage[] {
  const trimmed = append.trim()
  if (!trimmed) return messages
  const out = [...messages]
  const sysIdx = out.findIndex((m) => m.role === "system")
  if (sysIdx >= 0) {
    const sys = out[sysIdx]!
    const base = typeof sys.content === "string" ? sys.content : ""
    out[sysIdx] = { ...sys, content: base + append }
  } else {
    out.unshift({ role: "system", content: trimmed })
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
  /** Full AI chat / file analysis — Pro+. Free keeps core.files only. */
  const requireAiChat = [
    requireRole(["OWNER", "ADMIN", "MEMBER"]),
    requireFeature("ai.chat"),
  ]

  // ── Instance context for AI ─────────────────────────────────────────────────
  fastify.get(
    "/chat/context",
    { preHandler: requireAiChat },
    async (_request, reply) => {
      const [libraries, assetCounts, storageAgg, recentUpload, appDbRows, codeAssetRows] =
        await Promise.all([
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
        fastify.prisma.asset.findMany({
          where: { deletedAt: null, status: "READY" },
          orderBy: { createdAt: "desc" },
          take: 400,
          select: {
            id: true,
            originalFilename: true,
            mediaType: true,
            sizeBytes: true,
            createdAt: true,
            library: { select: { slug: true, name: true } },
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

      const codeFiles = codeAssetRows
        .filter((a) => a.mediaType === "CODE" || isCodeFilename(a.originalFilename))
        .slice(0, 80)
        .map((a) => ({
          id: a.id,
          filename: a.originalFilename,
          mediaType: a.mediaType,
          sizeBytes: Number(a.sizeBytes),
          librarySlug: a.library.slug,
          libraryName: a.library.name,
        }))

      const documentFiles = codeAssetRows
        .filter((a) => a.mediaType === "DOCUMENT")
        .slice(0, 80)
        .map((a) => ({
          id: a.id,
          filename: a.originalFilename,
          mediaType: a.mediaType,
          sizeBytes: Number(a.sizeBytes),
          librarySlug: a.library.slug,
          libraryName: a.library.name,
        }))

      // Most-recently uploaded assets across ALL libraries, newest first — lets
      // the assistant answer "what did I upload recently" with the actual files
      // in order instead of dumping the whole library.
      const recentAssets = codeAssetRows.slice(0, 15).map((a) => ({
        id: a.id,
        filename: a.originalFilename,
        mediaType: a.mediaType,
        librarySlug: a.library.slug,
        createdAt: a.createdAt.toISOString(),
      }))

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
        codeFiles,
        documentFiles,
        recentAssets,
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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
  const deleteConversationPreHandler = requireAiChat

  async function handleDeleteConversation(request: FastifyRequest, reply: FastifyReply) {
    const user = request.auth!.user
    const { id } = request.params as { id: string }
    const convo = await fastify.prisma.chatConversation.findFirst({
      where: { id, userId: user.id },
    })
    if (!convo) {
      reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } })
      return
    }
    await fastify.prisma.chatConversation.delete({ where: { id } })
    reply.send({ data: { success: true } })
  }

  fastify.delete(
    "/chat/conversations/:id",
    { preHandler: deleteConversationPreHandler },
    async (request, reply) => handleDeleteConversation(request, reply),
  )

  /** POST alias — mobile PWA often fails CORS preflight on DELETE. */
  fastify.post(
    "/chat/conversations/:id/delete",
    { preHandler: deleteConversationPreHandler },
    async (request, reply) => handleDeleteConversation(request, reply),
  )

  // ── Rename conversation ──────────────────────────────────────────────────────
  fastify.patch(
    "/chat/conversations/:id",
    { preHandler: requireAiChat },
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
      preHandler: requireAiChat,
      bodyLimit: 32 * 1024 * 1024,
    },
    async (request, reply) => {
      const parsed = chatSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }

      const { profileId, model: modelOverride, messages, focusAsset } = parsed.data

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

      let model: string
      try {
        model = await resolveChatModelName({
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          defaultModel: profile.defaultModel,
          override: modelOverride,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No model configured."
        reply.status(400).send({ error: { code: "NO_MODEL", message: msg } })
        return
      }

      if (!model.trim()) {
        reply.status(400).send({
          error: {
            code: "NO_MODEL",
            message:
              "No model selected. Set your chat model in AI Chat or a default model under Models.",
          },
        })
        return
      }

      reply.hijack()
      const raw = reply.raw
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        ...corsHeadersForRequestOrigin(request.headers.origin),
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

        if (focusAsset) {
          systemAppend += await buildFocusAssetSystemAppend(fastify.prisma, focusAsset)
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
            disableTools: Boolean(focusAsset),
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
          let compatAppend = systemAppend
          if (aiSettings.agent) {
            const priorUserTexts = messages.filter((m) => m.role === "user").map((m) => m.content)
            const readArgs = buildSyntheticReadTextAssetArgsFromUser(lastUserText, priorUserTexts)
            if (readArgs) {
              const readResult = await executeArciinChatTool(
                { function: { name: "read_text_asset", arguments: readArgs } },
                {
                  prisma: fastify.prisma,
                  storageRoot: instance?.storageRoot ?? null,
                  baseUrl,
                  model,
                  apiKey: profile.apiKey,
                  userId: request.auth!.user.id,
                  libraryToolAccess: security.libraryToolAccess,
                  publishRealtimeEvent: fastify.publishRealtimeEvent,
                },
              )
              if (typeof readResult.content === "string" && readResult.filename) {
                compatAppend += `\n\n--- File: ${readResult.filename} (user asked you to read/explain it) ---\n\`\`\`\n${readResult.content}\n\`\`\``
                if (readResult.truncated) {
                  compatAppend += "\n(Preview truncated — mention that if relevant.)"
                }
              } else if (readResult.error) {
                const msg =
                  typeof readResult.message === "string"
                    ? readResult.message
                    : JSON.stringify(readResult)
                compatAppend += `\n\n(File read failed: ${msg})`
              }
            }
          }
          const compatUsesVision = openAICompatUsesVision(messages)
          const compatSource = compatUsesVision
            ? messagesForOpenAICompat(messages)
            : messagesTextOnly(messages)
          const compatMessages = compatUsesVision
            ? appendSystemInstructionsOpenAI(
                sanitizeOpenAICompatMessages(compatSource as OpenAICompatMessage[], security),
                compatAppend,
              )
            : appendSystemInstructions(
                sanitizeMessagesForProvider(
                  compatSource as { role: string; content: string }[],
                  security,
                ),
                compatAppend,
              )
          await streamOpenAICompat({
            raw,
            baseUrl,
            apiKey: profile.apiKey ?? "",
            model,
            messages: compatMessages,
            provider: profile.provider,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Provider error"
        writeSseEvent(raw, { error: msg })
      } finally {
        raw.write("data: [DONE]\n\n")
        flushSseResponse(raw)
        raw.end()
      }
    },
  )

  fastify.get(
    "/chat/profiles",
    { preHandler: requireAiChat },
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
    { preHandler: requireAiChat },
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

  const chatSelectionPreHandler = requireAiChat

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

  const chatTtsSchema = z.object({
    text: z.string().min(1).max(12_000),
    profileId: z.string().optional(),
    voice: z.string().max(64).optional(),
  })

  fastify.post(
    "/chat/tts",
    { preHandler: requireAiChat },
    async (request, reply) => {
      const parsed = chatTtsSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid TTS request.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const cfg = (instance?.aiConfig as Record<string, unknown> | null) ?? {}
      const security = parseAiSecurityConfig(cfg.security)
      const text = sanitizeOutboundChatText(parsed.data.text, security, "assistant")
      if (!text.trim()) {
        reply.status(400).send({
          error: { code: "TTS_EMPTY_TEXT", message: "Nothing to read aloud after privacy filters." },
        })
        return
      }

      try {
        const { apiKey, ttsModel } = await resolveGeminiTtsConfig(
          fastify.prisma,
          parsed.data.profileId,
        )
        const { audio, mimeType } = await synthesizeGeminiTts({
          apiKey,
          text,
          voice: parsed.data.voice ?? DEFAULT_GEMINI_TTS_VOICE,
          model: ttsModel,
        })
        reply.send({
          data: {
            audioBase64: audio.toString("base64"),
            mimeType,
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "TTS failed"
        if (message === "GEMINI_NOT_CONFIGURED") {
          reply.status(400).send({
            error: {
              code: "GEMINI_NOT_CONFIGURED",
              message:
                "Connect Google Gemini under Models and add your API key to use read aloud.",
            },
          })
          return
        }
        if (message === "TTS_EMPTY_TEXT" || message === "TTS_NO_AUDIO") {
          reply.status(400).send({
            error: { code: message, message: "Could not generate speech for this reply." },
          })
          return
        }
        request.log.warn({ err }, "chat tts failed")
        reply.status(502).send({
          error: { code: "TTS_FAILED", message: "Gemini speech generation failed. Try again." },
        })
      }
    },
  )
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
  const think: boolean | string = /gpt-oss/i.test(model) ? "medium" : false

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
          if (delta) writeSseEvent(raw, { thinking: delta })
        }
        if (contentFull && contentFull !== prevContentFull) {
          const delta = contentFull.startsWith(prevContentFull)
            ? contentFull.slice(prevContentFull.length)
            : contentFull
          prevContentFull = contentFull
          if (delta) writeSseEvent(raw, { text: delta })
        }

        if (json.done) {
          const inputTokens  = json.prompt_eval_count ?? 0
          const outputTokens = json.eval_count ?? 0
          if (inputTokens > 0 || outputTokens > 0) {
            writeSseEvent(raw, {
              usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
            })
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
  raw, baseUrl, apiKey, model, messages, provider,
}: {
  raw: import("http").ServerResponse
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAICompatMessage[]
  provider?: string
}) {
  const isDeepSeek =
    provider === "deepseek" || /deepseek\.com/i.test(baseUrl)

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (isDeepSeek) {
    body.reasoning_effort = "medium"
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
        const delta = json.choices?.[0]?.delta as
          | { content?: string; thinking?: string; reasoning_content?: string }
          | undefined
        const thinking = delta?.reasoning_content ?? delta?.thinking
        const text = delta?.content

        if (thinking) writeSseEvent(raw, { thinking })
        if (text) writeSseEvent(raw, { text })

        if (json.usage?.total_tokens) {
          writeSseEvent(raw, {
            usage: {
              inputTokens: json.usage.prompt_tokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
            },
          })
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
          writeSseEvent(raw, { text: json.delta.text ?? "" })
        }
        if (json.type === "message_delta") {
          outputTokens = json.usage?.output_tokens ?? outputTokens
        }
        if (json.type === "message_stop") {
          if (inputTokens > 0 || outputTokens > 0) {
            writeSseEvent(raw, {
              usage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            })
          }
          return
        }
      } catch {
        // skip
      }
    }
  }
}
