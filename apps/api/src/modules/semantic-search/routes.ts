import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { isLocalOllamaUrl, semanticIndexVersion } from "@arciin/shared"
import { findLocalVisionModel, localModelStatus, pullLocalModel, semanticOllamaBaseUrl } from "@arciin/media-ai"

import { requireSessionRole } from "@/services/security/auth"
import { semanticSearchFor } from "@/services/search/hybrid-search"

/**
 * Owner controls for local semantic search.
 *
 * Off until the owner turns it on; indexing starts only when the owner says
 * so; a model is only ever installed by the owner pressing Install. Every
 * route is owner-only — the index and its status are not public, and nothing
 * here returns semantic text, captions or vectors.
 */

const INSTALL_KEY = "semantic:install"

type InstallProgress = { state: "running" | "done" | "failed"; completed: number | null; total: number | null; at: string }

export async function registerSemanticSearchRoutes(fastify: FastifyInstance) {
  const owner = requireSessionRole(["OWNER"])
  const baseUrl = () => semanticOllamaBaseUrl()

  const config = async () =>
    fastify.prisma.semanticSearchConfig.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} })

  async function status() {
    const cfg = await config()
    const url = baseUrl()
    const local = isLocalOllamaUrl(url)
    const model = local ? await localModelStatus({ baseUrl: url, model: cfg.embeddingModel }) : ({ ollama: "offline" } as const)
    const digest = model.ollama === "online" && model.installed ? model.model.digest : null
    const version = semanticIndexVersion(cfg.rebuildEpoch)
    const [counts] = await fastify.prisma.$queryRaw<
      Array<{ eligible: number; indexed: number; failed: number; skipped: number }>
    >`
      SELECT
        count(*)::int AS eligible,
        -- With Ollama offline the current digest is unknown: count what is
        -- stored for this model and version rather than reporting zero.
        count(*) FILTER (WHERE s.status = 'INDEXED' AND s."embeddingModel" = ${cfg.embeddingModel}
          AND (${digest}::text IS NULL OR s."embeddingDigest" = ${digest}) AND s."indexVersion" = ${version})::int AS indexed,
        count(*) FILTER (WHERE s.status = 'FAILED')::int AS failed,
        count(*) FILTER (WHERE s.status = 'SKIPPED' AND s."indexVersion" = ${version})::int AS skipped
      FROM "Asset" a
      LEFT JOIN "AssetSemanticIndex" s ON s."assetId" = a.id
      WHERE a."deletedAt" IS NULL AND a.status = 'READY'
    `
    const eligible = counts?.eligible ?? 0
    const indexed = counts?.indexed ?? 0
    const failed = counts?.failed ?? 0
    const skipped = counts?.skipped ?? 0
    const install = await fastify.redis.get(INSTALL_KEY).then((v) => (v ? (JSON.parse(v) as InstallProgress) : null)).catch(() => null)
    const captionModel = model.ollama === "online" ? await findLocalVisionModel({ baseUrl: url, preferred: cfg.captionModel }) : null
    const modelState =
      !local ? "not_local" : model.ollama === "offline" ? "ollama_offline" : model.installed ? "installed" : "missing"
    const pending = Math.max(0, eligible - indexed - failed - skipped)
    return {
      enabled: cfg.enabled,
      indexingActive: cfg.indexingActive,
      provider: "Local Ollama",
      embeddingModel: cfg.embeddingModel,
      model: {
        state: modelState,
        sizeBytes: model.ollama === "online" && model.installed ? model.model.sizeBytes : null,
        dimension: model.ollama === "online" && model.installed ? model.model.dimension : null,
        digest: digest ? digest.slice(0, 12) : null,
      },
      captionModel,
      index: {
        state: !cfg.enabled ? "off" : !cfg.indexingActive ? (indexed > 0 ? "paused" : "not_indexed") : pending > 0 ? "indexing" : "ready",
        eligible,
        indexed,
        pending,
        failed,
        skipped,
      },
      install,
    }
  }

  const reply200 = async (_request: unknown, reply: { header: (k: string, v: string) => unknown; send: (b: unknown) => unknown }) => {
    reply.header("Cache-Control", "no-store")
    reply.send({ data: await status() })
  }

  fastify.get("/semantic-search/status", { preHandler: owner }, async (request, reply) => {
    if (!request.auth) return
    await reply200(request, reply)
  })

  fastify.patch("/semantic-search/settings", { preHandler: owner }, async (request, reply) => {
    if (!request.auth) return
    const body = z.object({ enabled: z.boolean() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Send { enabled }." } })
    await config()
    await fastify.prisma.semanticSearchConfig.update({
      where: { id: "default" },
      // Turning it off also stops indexing; turning it on does not start it.
      data: body.data.enabled ? { enabled: true } : { enabled: false, indexingActive: false },
    })
    semanticSearchFor(fastify.prisma).invalidate()
    await reply200(request, reply)
  })

  const requireReady = async () => {
    const cfg = await config()
    if (!cfg.enabled) return "Turn on semantic search first."
    const model = await localModelStatus({ baseUrl: baseUrl(), model: cfg.embeddingModel })
    if (model.ollama === "offline") return "Ollama is not running on this server."
    if (!model.installed) return `Install ${cfg.embeddingModel} first.`
    return null
  }

  fastify.post("/semantic-search/index", { preHandler: owner }, async (request, reply) => {
    if (!request.auth) return
    const problem = await requireReady()
    if (problem) return reply.status(409).send({ error: { code: "SEMANTIC_NOT_READY", message: problem } })
    await fastify.prisma.semanticSearchConfig.update({
      where: { id: "default" },
      data: { indexingActive: true, indexingStartedAt: new Date() },
    })
    await reply200(request, reply)
  })

  fastify.post("/semantic-search/pause", { preHandler: owner }, async (request, reply) => {
    if (!request.auth) return
    await config()
    await fastify.prisma.semanticSearchConfig.update({ where: { id: "default" }, data: { indexingActive: false } })
    await reply200(request, reply)
  })

  /** Re-embed everything (after a model change, or on request). Old vectors stay usable until replaced. */
  fastify.post("/semantic-search/rebuild", { preHandler: owner }, async (request, reply) => {
    if (!request.auth) return
    const problem = await requireReady()
    if (problem) return reply.status(409).send({ error: { code: "SEMANTIC_NOT_READY", message: problem } })
    await fastify.prisma.semanticSearchConfig.update({
      where: { id: "default" },
      data: { rebuildEpoch: { increment: 1 }, indexingActive: true, indexingStartedAt: new Date() },
    })
    semanticSearchFor(fastify.prisma).invalidate()
    await reply200(request, reply)
  })

  /**
   * Install the embedding model into the local Ollama. Only ever this model,
   * only when the owner asks, and only on a local Ollama. Progress (Ollama's
   * own byte counts) is kept for the settings card to show.
   */
  fastify.post("/semantic-search/model/install", { preHandler: owner }, async (request, reply) => {
    if (!request.auth) return
    const body = z.object({ confirm: z.literal(true) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: "CONFIRM_REQUIRED", message: "Confirm the install." } })
    const cfg = await config()
    const url = baseUrl()
    if (!isLocalOllamaUrl(url)) return reply.status(409).send({ error: { code: "NOT_LOCAL", message: "Semantic search only uses a local Ollama." } })
    const running = await fastify.redis.get(INSTALL_KEY).then((v) => (v ? (JSON.parse(v) as InstallProgress) : null))
    if (running?.state === "running") return reply.status(409).send({ error: { code: "INSTALL_RUNNING", message: "The model is already being installed." } })
    const save = (p: Omit<InstallProgress, "at">) =>
      fastify.redis.set(INSTALL_KEY, JSON.stringify({ ...p, at: new Date().toISOString() }), "EX", 3600).catch(() => {})
    await save({ state: "running", completed: null, total: null })
    let last = 0
    void pullLocalModel({
      baseUrl: url,
      model: cfg.embeddingModel,
      onProgress: (p) => {
        if (Date.now() - last < 1000) return
        last = Date.now()
        void save({ state: "running", completed: p.completed, total: p.total })
      },
    })
      .then(() => save({ state: "done", completed: null, total: null }))
      .catch(() => save({ state: "failed", completed: null, total: null }))
      .finally(() => semanticSearchFor(fastify.prisma).invalidate())
    reply.status(202)
    await reply200(request, reply)
  })
}
