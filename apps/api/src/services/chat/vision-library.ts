import { access } from "node:fs/promises"
import fs from "node:fs/promises"
import path from "node:path"

import type { PrismaClient } from "@prisma/client"

import { ollamaVisionChat, parseVisionJsonObject } from "@/services/chat/vision-ollama"
import { getStoragePaths, sanitizeFilename } from "@/services/storage/local-storage"

const MAX_FULL_BYTES = 4 * 1024 * 1024
const MAX_THUMB_BYTES = 2 * 1024 * 1024
const VISION_BATCH_SIZE = 4
export const DEFAULT_SCAN_LIMIT = 48

import { normalizeVisionSearchQuery } from "@arciin/shared"

export { normalizeVisionSearchQuery }

export type VisionImageCandidate = {
  assetId: string
  originalFilename: string
  base64: string
}

export type VisionSearchMatch = {
  assetId: string
  originalFilename: string
  confidence: number
  summary: string
}

export type VisionRenameSuggestion = {
  assetId: string
  suggestedTitle: string
  suggestedFilename: string
}

async function loadVisionBase64(
  asset: { id: string; storageObject: { physicalPath: string } | null },
  thumbnailsDir: string,
): Promise<string | null> {
  const thumbPath = path.join(thumbnailsDir, `${asset.id}.webp`)
  try {
    await access(thumbPath)
    const buf = await fs.readFile(thumbPath)
    if (buf.length > 0 && buf.length <= MAX_THUMB_BYTES) {
      return buf.toString("base64")
    }
  } catch {
    /* use full file */
  }

  const p = asset.storageObject?.physicalPath
  if (!p) return null
  try {
    const stat = await fs.stat(p)
    if (stat.size > MAX_FULL_BYTES) return null
    const buf = await fs.readFile(p)
    return buf.toString("base64")
  } catch {
    return null
  }
}

export async function loadSingleImageForVision(
  prisma: PrismaClient,
  storageRoot: string | null | undefined,
  assetId: string,
): Promise<VisionImageCandidate | null> {
  const { thumbnailsDir } = getStoragePaths(storageRoot ?? undefined)
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null, mediaType: "IMAGE", status: "READY" },
    include: { storageObject: true },
  })
  if (!asset) return null
  const base64 = await loadVisionBase64(asset, thumbnailsDir)
  if (!base64) return null
  return { assetId: asset.id, originalFilename: asset.originalFilename, base64 }
}

export async function loadImageCandidatesForVision(
  prisma: PrismaClient,
  storageRoot: string | null | undefined,
  maxCandidates: number,
  opts?: { queryHint?: string; skip?: number },
): Promise<VisionImageCandidate[]> {
  const { thumbnailsDir } = getStoragePaths(storageRoot ?? undefined)
  const seen = new Set<string>()
  const out: VisionImageCandidate[] = []

  async function pushFromRows(
    rows: Array<{
      id: string
      originalFilename: string
      storageObject: { physicalPath: string } | null
    }>,
  ) {
    for (const asset of rows) {
      if (out.length >= maxCandidates) return
      if (seen.has(asset.id)) continue
      const base64 = await loadVisionBase64(asset, thumbnailsDir)
      if (!base64) continue
      seen.add(asset.id)
      out.push({
        assetId: asset.id,
        originalFilename: asset.originalFilename,
        base64,
      })
    }
  }

  const hint = opts?.queryHint?.trim()
  if (hint) {
    const terms = [...new Set(hint.toLowerCase().split(/[^\w]+/).filter((w) => w.length > 2))]
    if (terms.length > 0) {
      const keywordRows = await prisma.asset.findMany({
        where: {
          deletedAt: null,
          mediaType: "IMAGE",
          status: "READY",
          OR: terms.flatMap((term) => [
            { title: { contains: term, mode: "insensitive" as const } },
            { description: { contains: term, mode: "insensitive" as const } },
            { originalFilename: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        orderBy: { createdAt: "desc" },
        take: 24,
        include: { storageObject: true },
      })
      await pushFromRows(keywordRows)
    }
  }

  const rows = await prisma.asset.findMany({
    where: { deletedAt: null, mediaType: "IMAGE", status: "READY" },
    orderBy: { createdAt: "desc" },
    skip: opts?.skip ?? 0,
    take: Math.max(maxCandidates * 3, maxCandidates),
    include: { storageObject: true },
  })
  await pushFromRows(rows)
  return out
}

const QUERY_VISUAL_HINTS: Record<string, string> = {
  graduation:
    "cap and gown, mortarboard, graduation ceremony, commencement, diploma, school graduate",
  wedding: "wedding dress, bride, groom, ceremony, reception",
  birthday: "birthday cake, candles, party, balloons",
}

function visualHintsForQuery(query: string): string {
  const key = query.toLowerCase().trim()
  for (const [term, hint] of Object.entries(QUERY_VISUAL_HINTS)) {
    if (key.includes(term)) return hint
  }
  return ""
}

function parseVisionSearchMatches(
  content: string,
  batch: VisionImageCandidate[],
): VisionSearchMatch[] {
  const parsed = parseVisionJsonObject(content)
  const rawMatches = Array.isArray(parsed?.matches) ? parsed.matches : []
  const out: VisionSearchMatch[] = []

  for (const item of rawMatches) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const index = typeof rec.index === "number" ? rec.index : Number(rec.index)
    if (!Number.isInteger(index) || index < 0 || index >= batch.length) continue
    const confidence = typeof rec.confidence === "number" ? rec.confidence : 0.5
    const summary = typeof rec.summary === "string" ? rec.summary : "Matches query"
    const cand = batch[index]!
    out.push({
      assetId: cand.assetId,
      originalFilename: cand.originalFilename,
      confidence,
      summary,
    })
  }
  return out
}

async function scanBatchesForMatches(opts: {
  baseUrl: string
  model: string
  query: string
  candidates: VisionImageCandidate[]
  relaxed: boolean
}): Promise<VisionSearchMatch[]> {
  const { baseUrl, model, query, candidates, relaxed } = opts
  const hints = visualHintsForQuery(query)
  const allMatches: VisionSearchMatch[] = []

  for (let offset = 0; offset < candidates.length; offset += VISION_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + VISION_BATCH_SIZE)
    const labels = batch
      .map((c, i) => `Image ${i}: stored as "${c.originalFilename}"`)
      .join("\n")

    const prompt = relaxed
      ? [
          "You are a visual search engine. The user wants photos matching a subject.",
          `Subject: "${query}"`,
          hints ? `Visual cues: ${hints}` : "",
          "",
          labels,
          "",
          `${batch.length} image(s) attached (indices 0..${batch.length - 1}).`,
          "Include ANY image whose scene depicts this subject. Ignore misleading filenames.",
          "Reply with ONLY JSON:",
          '{"matches":[{"index":0,"confidence":0.9,"summary":"what you see"}]}',
          "Use confidence 0.5+ for plausible matches. Empty array only if none relate.",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "You are a visual search engine for a private photo library.",
          `User is looking for: "${query}"`,
          hints ? `Look for: ${hints}` : "",
          "",
          labels,
          "",
          `${batch.length} image(s) attached in order (image 0 .. image ${batch.length - 1}).`,
          "Match by what you SEE in the pixels, not by filename.",
          "Reply with ONLY valid JSON, no markdown:",
          '{"matches":[{"index":0,"confidence":0.95,"summary":"brief what you see"}]}',
          "confidence 0-1. If none match, {\"matches\":[]}.",
        ]
          .filter(Boolean)
          .join("\n")

    const content = await ollamaVisionChat(
      baseUrl,
      model,
      prompt,
      batch.map((c) => c.base64),
    )
    allMatches.push(...parseVisionSearchMatches(content, batch))

    if (!relaxed && allMatches.some((m) => m.confidence >= 0.85)) break
  }

  return allMatches
}

export async function visionSearchLibraryImages(opts: {
  baseUrl: string
  model: string
  query: string
  candidates: VisionImageCandidate[]
  maxResults: number
}): Promise<VisionSearchMatch[]> {
  const { baseUrl, model, candidates, maxResults } = opts
  const query = normalizeVisionSearchQuery(opts.query)
  if (candidates.length === 0) return []

  let allMatches = await scanBatchesForMatches({
    baseUrl,
    model,
    query,
    candidates,
    relaxed: false,
  })

  if (allMatches.length === 0) {
    allMatches = await scanBatchesForMatches({
      baseUrl,
      model,
      query,
      candidates,
      relaxed: true,
    })
  }

  return allMatches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults)
}


export async function visionSuggestAssetRename(opts: {
  baseUrl: string
  model: string
  candidate: VisionImageCandidate
}): Promise<{ title: string; filename: string; description: string }> {
  const prompt = [
    "Describe this image briefly, then suggest a short human title and a safe filename.",
    `Current filename: "${opts.candidate.originalFilename}"`,
    "Reply with ONLY valid JSON:",
    '{"title":"Short title","filename":"descriptive-name.jpg","description":"One sentence"}',
    "filename: lowercase, hyphens, keep original extension if possible.",
  ].join("\n")

  const content = await ollamaVisionChat(opts.baseUrl, opts.model, prompt, [opts.candidate.base64])
  const parsed = parseVisionJsonObject(content)
  const ext = path.extname(opts.candidate.originalFilename) || ".jpg"
  const rawName = typeof parsed?.filename === "string" ? parsed.filename : "renamed-image"
  const base = sanitizeFilename(rawName.replace(/\.[a-z0-9]+$/i, "")) || "renamed-image"
  const filename = base.includes(".") ? base : `${base}${ext}`

  return {
    title: typeof parsed?.title === "string" ? parsed.title.slice(0, 200) : "Untitled",
    filename: filename.slice(0, 200),
    description: typeof parsed?.description === "string" ? parsed.description.slice(0, 500) : "",
  }
}
