import type { PrismaClient } from "@prisma/client"

import {
  SEMANTIC_MAX_RESULTS,
  SEMANTIC_MIN_SIMILARITY,
  decodeVector,
  semanticIndexVersion,
  topBySimilarity,
  type ScoredId,
} from "@arciin/shared"
import { embedText, localModelStatus, semanticOllamaBaseUrl } from "@arciin/media-ai"

/**
 * Semantic hits for a search, from the local index.
 *
 * Search never calls a vision model and never waits long: one small text
 * embedding for the query (cached), a dot product against vectors held in
 * memory, and a hard deadline after which the caller simply shows its literal
 * results. Every hit is only a candidate id — the caller filters it through
 * the same visible-asset query as any listing, so nothing here decides what a
 * person may see.
 */

export type SemanticAvailability =
  /** Semantic hits were computed (possibly none). */
  | "used"
  /** Turned off, or never enabled. */
  | "disabled"
  /** On, but Ollama is unreachable, the model is missing, or it was too slow. */
  | "unavailable"
  /** On and reachable, but nothing is indexed yet. */
  | "not_indexed"

export type SemanticCandidates = { status: SemanticAvailability; hits: ScoredId[] }

/**
 * A query embedding slower than this is abandoned; the page shows literal
 * results. Measured on a 4-core CPU-only host: ~1 s idle, ~2.1 s while the
 * worker is captioning.
 */
export const SEMANTIC_QUERY_DEADLINE_MS = 4_000

type ModelState = { at: number; digest: string | null; available: boolean }
type VectorState = {
  key: string
  watermark: string
  vectors: Map<string, Float32Array>
}

const CONFIG_TTL_MS = 10_000
const MODEL_TTL_MS = 60_000
const QUERY_CACHE_SIZE = 200

export class SemanticSearchService {
  private config: { at: number; value: { enabled: boolean; embeddingModel: string; rebuildEpoch: number } | null } | null = null
  private model: ModelState | null = null
  private vectors: VectorState | null = null
  private queryCache = new Map<string, Float32Array>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: {
      baseUrl?: string
      fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
      now?: () => number
      deadlineMs?: number
    } = {},
  ) {}

  private get baseUrl() {
    return this.deps.baseUrl ?? semanticOllamaBaseUrl()
  }
  private now() {
    return this.deps.now?.() ?? Date.now()
  }

  /** Forget cached settings and model state (after the owner changes something). */
  invalidate() {
    this.config = null
    this.model = null
  }

  private async loadConfig() {
    if (this.config && this.now() - this.config.at < CONFIG_TTL_MS) return this.config.value
    const row = await this.prisma.semanticSearchConfig.findUnique({ where: { id: "default" } })
    const value = row ? { enabled: row.enabled, embeddingModel: row.embeddingModel, rebuildEpoch: row.rebuildEpoch } : null
    this.config = { at: this.now(), value }
    return value
  }

  private async modelState(model: string): Promise<ModelState> {
    if (this.model && this.now() - this.model.at < MODEL_TTL_MS) return this.model
    const status = await localModelStatus({ baseUrl: this.baseUrl, model, fetchImpl: this.deps.fetchImpl, timeoutMs: 1_500 })
    this.model = {
      at: this.now(),
      available: status.ollama === "online" && status.installed,
      digest: status.ollama === "online" && status.installed ? status.model.digest : null,
    }
    return this.model
  }

  /**
   * Vectors for the current model build and index version, kept in memory and
   * reloaded only when the index changes (its newest update or row count).
   * 768 floats are 3 KB, so ten thousand assets are ~30 MB.
   */
  private async loadVectors(model: string, digest: string | null, indexVersion: number): Promise<Map<string, Float32Array>> {
    const key = `${model}|${digest ?? ""}|${indexVersion}`
    const [mark] = await this.prisma.$queryRaw<Array<{ n: number; latest: Date | null }>>`
      SELECT count(*)::int AS n, max("indexedAt") AS latest
      FROM "AssetSemanticIndex"
      WHERE status = 'INDEXED' AND "embeddingModel" = ${model}
        AND "embeddingDigest" IS NOT DISTINCT FROM ${digest} AND "indexVersion" = ${indexVersion}
    `
    const watermark = `${mark?.n ?? 0}|${mark?.latest?.toISOString() ?? ""}`
    if (this.vectors && this.vectors.key === key && this.vectors.watermark === watermark) return this.vectors.vectors
    const rows = await this.prisma.assetSemanticIndex.findMany({
      where: { status: "INDEXED", embeddingModel: model, embeddingDigest: digest, indexVersion, embedding: { not: null } },
      select: { assetId: true, embedding: true },
    })
    const vectors = new Map<string, Float32Array>()
    for (const row of rows) if (row.embedding) vectors.set(row.assetId, decodeVector(new Uint8Array(row.embedding)))
    this.vectors = { key, watermark, vectors }
    return vectors
  }

  private async queryVector(model: string, digest: string | null, query: string): Promise<Float32Array> {
    const cacheKey = `${model}|${digest ?? ""}|${query.toLowerCase().trim()}`
    const cached = this.queryCache.get(cacheKey)
    if (cached) {
      this.queryCache.delete(cacheKey)
      this.queryCache.set(cacheKey, cached)
      return cached
    }
    const vector = await embedText({
      baseUrl: this.baseUrl,
      model,
      text: query,
      kind: "query",
      timeoutMs: this.deps.deadlineMs ?? SEMANTIC_QUERY_DEADLINE_MS,
      fetchImpl: this.deps.fetchImpl,
    })
    this.queryCache.set(cacheKey, vector)
    if (this.queryCache.size > QUERY_CACHE_SIZE) this.queryCache.delete(this.queryCache.keys().next().value!)
    return vector
  }

  /**
   * Candidate ids for `query`, best first, above the measured threshold.
   * Never throws: any failure is "unavailable", and the caller keeps its
   * literal results.
   */
  async candidates(query: string): Promise<SemanticCandidates> {
    const text = query.trim()
    if (text.length < 2) return { status: "used", hits: [] }
    try {
      const config = await this.loadConfig()
      if (!config?.enabled) return { status: "disabled", hits: [] }
      const run = async (): Promise<SemanticCandidates> => {
        const model = await this.modelState(config.embeddingModel)
        if (!model.available) return { status: "unavailable", hits: [] }
        const vectors = await this.loadVectors(config.embeddingModel, model.digest, semanticIndexVersion(config.rebuildEpoch))
        if (vectors.size === 0) return { status: "not_indexed", hits: [] }
        const queryVector = await this.queryVector(config.embeddingModel, model.digest, text)
        return {
          status: "used",
          hits: topBySimilarity(queryVector, vectors.entries(), SEMANTIC_MIN_SIMILARITY, SEMANTIC_MAX_RESULTS * 4),
        }
      }
      let timer: NodeJS.Timeout | undefined
      const deadline = new Promise<SemanticCandidates>((resolve) => {
        timer = setTimeout(() => resolve({ status: "unavailable", hits: [] }), (this.deps.deadlineMs ?? SEMANTIC_QUERY_DEADLINE_MS) + 500)
      })
      try {
        return await Promise.race([run(), deadline])
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Ollama down, model missing, a bad response: literal search carries on.
      this.model = null
      return { status: "unavailable", hits: [] }
    }
  }
}
