import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import type { PrismaClient } from "@prisma/client"
import sharp from "sharp"

import {
  DEFAULT_EMBEDDING_MODEL,
  buildAssetSemanticText,
  encodeVector,
  hasMeaningfulSemanticText,
  semanticIndexVersion,
} from "@arciin/shared"
import {
  SemanticOllamaError,
  captionImageLocally,
  embedTexts,
  findLocalVisionModel,
  localModelStatus,
  semanticFingerprint,
} from "@arciin/media-ai"

/**
 * Semantic indexing for one asset: caption once, embed once.
 *
 * Enrichment, never correctness: nothing here changes Asset.status, title or
 * description, whatever happens. A failure is recorded on the index row as a
 * short code and retried later with backoff; the asset stays exactly as it
 * was. Only an Ollama on this machine or its network is ever contacted, and
 * no caption or document text is written to a log.
 */

export type SemanticIndexDeps = {
  prisma: PrismaClient
  storageRoot: string
  baseUrl: string
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}

export type SemanticIndexOutcome =
  | "disabled"
  | "gone"
  | "skipped-unchanged"
  | "skipped-no-meaning"
  | "indexed"
  | "failed"

/** Longest side of the image the vision model sees. ARCIIN_SEMANTIC_CAPTION_PX, 128–1024, default 256. */
export function captionPixels(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ARCIIN_SEMANTIC_CAPTION_PX)
  return Number.isFinite(raw) && raw >= 128 && raw <= 1024 ? Math.round(raw) : 256
}

/** An image's source for captioning: the thumbnail if present, else the file itself when small enough. */
const MAX_CAPTION_SOURCE_BYTES = 25 * 1024 * 1024

async function captionSource(
  storageRoot: string,
  asset: { id: string; mediaType: string; storageObject: { physicalPath: string } | null },
): Promise<string | null> {
  const candidates = [path.join(storageRoot, "thumbnails", `${asset.id}.webp`)]
  if (asset.mediaType === "IMAGE" && asset.storageObject?.physicalPath) candidates.push(asset.storageObject.physicalPath)
  for (const file of candidates) {
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size === 0 || info.size > MAX_CAPTION_SOURCE_BYTES) continue
      // A small JPEG: every vision model reads it, and on a CPU-only host the
      // image encoder dominates caption time. Measured with qwen3.5:0.8b on a
      // 4-core server: 256px 41 s, 384px 126 s, 512px 109 s — and 256px still
      // named "birthday", "party hats", "cake", "balloons".
      const px = captionPixels()
      const jpeg = await sharp(await readFile(file), { failOn: "none" })
        .rotate()
        .resize(px, px, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer()
      return jpeg.toString("base64")
    } catch {
      /* next candidate */
    }
  }
  return null
}

function failureCode(error: unknown): string {
  if (error instanceof SemanticOllamaError) return error.code
  return "INDEX_ERROR"
}

export async function indexAssetSemantics(assetId: string, deps: SemanticIndexDeps): Promise<SemanticIndexOutcome> {
  const { prisma } = deps
  const config = await prisma.semanticSearchConfig.findUnique({ where: { id: "default" } })
  if (!config?.enabled) return "disabled"

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      library: { select: { name: true } },
      folder: { select: { name: true } },
      transcript: { select: { status: true, fullText: true } },
      storageObject: { select: { physicalPath: true } },
      semanticIndex: true,
    },
  })
  if (!asset || asset.deletedAt || asset.status !== "READY") return "gone"

  const model = config.embeddingModel || DEFAULT_EMBEDDING_MODEL
  const indexVersion = semanticIndexVersion(config.rebuildEpoch)
  const existing = asset.semanticIndex

  const record = async (data: Record<string, unknown>) => {
    await prisma.assetSemanticIndex.upsert({
      where: { assetId },
      create: { assetId, ...data },
      update: data,
    })
  }

  try {
    // 0. Ollama and the model, first: an outage must be a retryable failure,
    //    never read as "no vision model" (which would skip a photo for good).
    //    The digest pins which model build the vector comes from.
    const status = await localModelStatus({ baseUrl: deps.baseUrl, model, fetchImpl: deps.fetchImpl })
    if (status.ollama === "offline") throw new SemanticOllamaError("OLLAMA_OFFLINE", "Ollama is not reachable.")
    if (!status.installed) throw new SemanticOllamaError("MODEL_MISSING", `The model ${model} is not installed.`)
    const digest = status.model.digest

    // 1. Caption — images, and videos that have a thumbnail. Once per file:
    //    kept until the file itself changes.
    let caption = existing?.caption ?? null
    let captionModel = existing?.captionModel ?? null
    const captionStale = existing?.captionSourceChecksum !== asset.checksumSha256
    if ((asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO") && (!caption || captionStale)) {
      const visionModel = await findLocalVisionModel({ baseUrl: deps.baseUrl, preferred: config.captionModel, fetchImpl: deps.fetchImpl })
      const image = visionModel ? await captionSource(deps.storageRoot, asset) : null
      if (visionModel && image) {
        caption = await captionImageLocally({ baseUrl: deps.baseUrl, model: visionModel, imageBase64: image, fetchImpl: deps.fetchImpl })
        captionModel = visionModel
        await record({ caption, captionModel, captionSourceChecksum: asset.checksumSha256 })
      } else if (captionStale) {
        caption = null
      }
    }

    // 2. The one canonical text.
    const input = {
      originalFilename: asset.originalFilename,
      title: asset.title,
      description: asset.description,
      mediaType: asset.mediaType,
      libraryName: asset.library?.name,
      folderName: asset.folder?.name,
      documentAuthor: asset.documentAuthor,
      documentSubject: asset.documentSubject,
      documentInsight: asset.documentInsight,
      caption,
      durationSeconds: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      transcriptText: asset.transcript?.status === "READY" ? asset.transcript.fullText : null,
      importSourceUrl: asset.importSourceUrl,
    }
    const semanticText = buildAssetSemanticText(input)

    if (!hasMeaningfulSemanticText(input)) {
      // A camera file name and nothing else: nothing to find by meaning.
      await record({
        status: "SKIPPED",
        semanticText,
        embedding: null,
        indexVersion,
        fingerprint: null,
        errorCode: null,
        attempts: 0,
        indexedAt: new Date(),
      })
      return "skipped-no-meaning"
    }

    // 3. Unchanged since the last embedding? Then there is nothing to do.
    const fingerprint = semanticFingerprint({ embeddingModel: model, embeddingDigest: digest, indexVersion, semanticText })
    if (existing?.status === "INDEXED" && existing.fingerprint === fingerprint && existing.embedding) {
      // Nothing that feeds the vector changed. Touch the row so the sweep
      // does not look at it again until the asset changes.
      await record({ errorCode: null })
      return "skipped-unchanged"
    }

    // 4. Embed and keep.
    const [vector] = await embedTexts({
      baseUrl: deps.baseUrl,
      model,
      texts: [semanticText],
      kind: "document",
      expectedDimension: status.model.dimension ?? undefined,
      fetchImpl: deps.fetchImpl,
    })
    await record({
      status: "INDEXED",
      semanticText,
      embedding: Buffer.from(encodeVector(vector!)),
      embeddingModel: model,
      embeddingDigest: digest,
      dimension: vector!.length,
      indexVersion,
      fingerprint,
      errorCode: null,
      attempts: 0,
      indexedAt: new Date(),
    })
    return "indexed"
  } catch (error) {
    await record({
      status: "FAILED",
      errorCode: failureCode(error),
      attempts: (existing?.attempts ?? 0) + 1,
    }).catch(() => {})
    if (error instanceof SemanticOllamaError && error.transient) throw error
    return "failed"
  }
}

/** Failed rows are retried after 2^attempts minutes, and given up on after this many. */
export const SEMANTIC_MAX_ATTEMPTS = 5

/**
 * Assets whose index is missing or out of date, newest first. Out of date
 * means: never indexed; built for another model, model build or index
 * version; or the asset (or its transcript) changed since. The fingerprint
 * check in indexAssetSemantics then skips any whose text did not actually
 * change.
 */
export async function findAssetsNeedingSemanticIndex(
  prisma: PrismaClient,
  input: { model: string; digest: string | null; indexVersion: number; limit: number },
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT a.id
    FROM "Asset" a
    LEFT JOIN "AssetSemanticIndex" s ON s."assetId" = a.id
    LEFT JOIN "MediaTranscript" t ON t."assetId" = a.id
    WHERE a."deletedAt" IS NULL
      AND a.status = 'READY'
      AND (
        s."assetId" IS NULL
        OR s.status = 'PENDING'
        OR (
          s.status IN ('INDEXED', 'SKIPPED')
          AND (
            s."indexVersion" <> ${input.indexVersion}
            OR (s.status = 'INDEXED' AND (s."embeddingModel" IS DISTINCT FROM ${input.model} OR s."embeddingDigest" IS DISTINCT FROM ${input.digest}))
            OR a."updatedAt" > s."updatedAt"
            OR t."updatedAt" > s."updatedAt"
          )
        )
        OR (
          s.status = 'FAILED'
          AND s.attempts < ${SEMANTIC_MAX_ATTEMPTS}
          AND s."updatedAt" < now() - (interval '1 minute' * power(2, s.attempts))
        )
      )
    ORDER BY a."createdAt" DESC
    LIMIT ${input.limit}
  `
  return rows.map((r) => r.id)
}
