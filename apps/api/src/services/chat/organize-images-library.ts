import type { PrismaClient } from "@prisma/client"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { slugify } from "@/services/slug"

import {
  loadSingleImageForVision,
  type VisionImageCandidate,
} from "@/services/chat/vision-library"
import { ollamaVisionChat, parseVisionJsonObject } from "@/services/chat/vision-ollama"

export type OrganizeImageResult = {
  assetId: string
  originalFilename: string
  status: "moved" | "skipped" | "failed"
  folderName?: string
  folderId?: string
  createdFolder?: boolean
  summary?: string
  error?: string
}

type FolderRow = { id: string; name: string; slug: string }

function sanitizeFolderName(raw: string): string {
  const cleaned = raw
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
  return cleaned || "Miscellaneous"
}

function matchFolder(folders: FolderRow[], name: string): FolderRow | undefined {
  const slug = slugify(name)
  return folders.find(
    (f) => f.slug === slug || f.name.toLowerCase() === name.toLowerCase(),
  )
}

async function visionSuggestImageFolder(opts: {
  baseUrl: string
  model: string
  apiKey?: string | null
  candidate: VisionImageCandidate
  existingFolderNames: string[]
}): Promise<{ folderName: string; createNew: boolean; summary: string }> {
  const folderList =
    opts.existingFolderNames.length > 0
      ? opts.existingFolderNames.map((n) => `"${n}"`).join(", ")
      : "(none yet)"

  const prompt = [
    "You are organizing one photo into folders in a private image library.",
    `Existing folders: ${folderList}`,
    `File metadata name (ignore if generic like thumbnail.webp): "${opts.candidate.originalFilename}"`,
    "",
    "Classify the attached image by visual content only.",
    "Pick the best existing folder name EXACTLY, or propose one new short folder name (2–4 words).",
    "Reply with ONLY valid JSON:",
    '{"folder":"Folder Name","createNew":false,"summary":"one sentence what you see"}',
    "Set createNew true only when the folder name is not in the existing list.",
  ].join("\n")

  const content = await ollamaVisionChat(
    opts.baseUrl,
    opts.model,
    prompt,
    [opts.candidate.base64],
    opts.apiKey,
  )
  const parsed = parseVisionJsonObject(content)
  const folderRaw = typeof parsed?.folder === "string" ? parsed.folder : "Miscellaneous"
  const folderName = sanitizeFolderName(folderRaw)
  const createNew = parsed?.createNew === true
  const summary =
    typeof parsed?.summary === "string" ? parsed.summary.slice(0, 300) : "Image classified"

  return { folderName, createNew, summary }
}

async function ensureFolder(
  prisma: PrismaClient,
  libraryId: string,
  folders: FolderRow[],
  folderName: string,
): Promise<{ folder: FolderRow; created: boolean }> {
  const existing = matchFolder(folders, folderName)
  if (existing) return { folder: existing, created: false }

  const slug = slugify(folderName)
  const pathCache = slug
  const created = await prisma.folder.create({
    data: {
      libraryId,
      name: folderName,
      slug,
      pathCache,
    },
  })
  const row = { id: created.id, name: created.name, slug: created.slug }
  folders.push(row)
  return { folder: row, created: true }
}

export async function organizeImagesLibrary(opts: {
  prisma: PrismaClient
  storageRoot: string | null | undefined
  baseUrl: string
  model: string
  apiKey?: string | null
  userId: string
  maxAssets?: number
  publishRealtimeEvent?: (event: import("@arciin/shared").RealtimeEvent) => Promise<void>
}): Promise<{
  libraryId: string
  libraryName: string
  processed: number
  results: OrganizeImageResult[]
}> {
  const maxAssets = Math.min(30, Math.max(1, opts.maxAssets ?? 20))

  const library = await opts.prisma.library.findFirst({
    where: { kind: "IMAGE" },
    orderBy: { createdAt: "asc" },
  })

  if (!library) {
    throw new Error("Images library not found on this instance.")
  }

  const folderRows = await opts.prisma.folder.findMany({
    where: { libraryId: library.id, deletedAt: null },
    orderBy: { pathCache: "asc" },
    select: { id: true, name: true, slug: true },
  })
  const folders: FolderRow[] = [...folderRows]

  // Root only — files already filed into a folder stay there. Organizing
  // again would yank them back out of the place Chat just put them.
  const assets = await opts.prisma.asset.findMany({
    where: {
      libraryId: library.id,
      deletedAt: null,
      mediaType: "IMAGE",
      status: "READY",
      folderId: null,
    },
    orderBy: { createdAt: "asc" },
    take: maxAssets,
    select: { id: true, originalFilename: true, folderId: true },
  })

  const results: OrganizeImageResult[] = []

  for (const asset of assets) {
    try {
      const candidate = await loadSingleImageForVision(
        opts.prisma,
        opts.storageRoot,
        asset.id,
      )
      if (!candidate) {
        results.push({
          assetId: asset.id,
          originalFilename: asset.originalFilename,
          status: "failed",
          error: "Could not read image file for vision",
        })
        continue
      }

      const suggestion = await visionSuggestImageFolder({
        baseUrl: opts.baseUrl,
        model: opts.model,
        apiKey: opts.apiKey,
        candidate,
        existingFolderNames: folders.map((f) => f.name),
      })

      const { folder, created } = await ensureFolder(
        opts.prisma,
        library.id,
        folders,
        suggestion.folderName,
      )

      if (asset.folderId === folder.id) {
        results.push({
          assetId: asset.id,
          originalFilename: asset.originalFilename,
          status: "skipped",
          folderName: folder.name,
          folderId: folder.id,
          summary: suggestion.summary,
        })
        continue
      }

      await opts.prisma.asset.update({
        where: { id: asset.id },
        data: { folderId: folder.id },
      })

      await recordAndBroadcastActivity(
        { prisma: opts.prisma, publishRealtimeEvent: opts.publishRealtimeEvent },
        {
        userId: opts.userId,
        type: "asset.moved",
        title: "Image organized",
        message: `${asset.originalFilename} → ${folder.name}`,
        entityType: "asset",
        entityId: asset.id,
        metadata: { folderId: folder.id, organizedByAi: true },
      },
      )

      if (created) {
        await recordAndBroadcastActivity(
          { prisma: opts.prisma, publishRealtimeEvent: opts.publishRealtimeEvent },
          {
            userId: opts.userId,
            type: "folder.created",
            title: "Folder created",
            message: `${folder.name} was created while organizing images.`,
            entityType: "folder",
            entityId: folder.id,
          },
        )
      }

      results.push({
        assetId: asset.id,
        originalFilename: asset.originalFilename,
        status: "moved",
        folderName: folder.name,
        folderId: folder.id,
        createdFolder: created,
        summary: suggestion.summary,
      })
    } catch (err) {
      results.push({
        assetId: asset.id,
        originalFilename: asset.originalFilename,
        status: "failed",
        error: err instanceof Error ? err.message : "Organization failed",
      })
    }
  }

  return {
    libraryId: library.id,
    libraryName: library.name,
    processed: results.length,
    results,
  }
}
