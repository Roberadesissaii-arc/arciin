import type { PrismaClient } from "@prisma/client"
import type { AiLibraryToolAccess } from "@arciin/shared"
import { libraryAllowsFolderMutations, libraryAllowsOrganize } from "@arciin/shared"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { organizeImagesLibrary } from "@/services/chat/organize-images-library"
import {
  loadImageCandidatesForVision,
  normalizeVisionSearchQuery,
  visionSearchLibraryImages,
} from "@/services/chat/vision-library"
import { readPdfAssetContent } from "@/services/chat/read-pdf-asset"
import { readTextAssetContent } from "@/services/chat/read-text-asset"
import { slugify } from "@/services/slug"

export type ArciinChatToolContext = {
  prisma: PrismaClient
  storageRoot: string | null | undefined
  baseUrl: string
  model: string
  apiKey?: string | null
  userId: string
  /** Defaults to full access when omitted. */
  libraryToolAccess?: AiLibraryToolAccess
  publishRealtimeEvent?: (event: import("@arciin/shared").RealtimeEvent) => Promise<void>
}

export const ARCIIN_CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "vision_search_library",
      description:
        "Search the user's Images library by visual content (cap/gown, scenes, subjects). Use when they want to find photos matching a description.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Short visual subject to search for, e.g. graduation, dog, beach sunset",
          },
          maxResults: {
            type: "number",
            description: "Max matches to return (1-5)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "organize_images_library",
      description:
        "Review images in the Images library and move each into an appropriate folder (create folders when needed) based on visual content.",
      parameters: {
        type: "object",
        properties: {
          maxAssets: {
            type: "number",
            description: "How many images to process this turn (1-30, default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_library_folder",
      description:
        "Create a folder inside one of the fixed libraries (videos, images, music, documents, inbox). Use when the user asks you to create a folder in their library from chat.",
      parameters: {
        type: "object",
        properties: {
          library_slug: {
            type: "string",
            description: "Library slug: videos | images | music | documents | inbox",
          },
          name: { type: "string", description: "Folder name to create" },
          parent_folder_id: {
            type: "string",
            description: "Optional parent folder id for nesting; omit for root of that library.",
          },
        },
        required: ["library_slug", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_pdf_asset",
      description:
        "Extract text from a PDF with a PDF page index (printed page vs PDF page vs chapter). Markers look like --- PDF page 66 · printed page 43 · Chapter 4 ---. Use [goto-page:N] with PDF page N from the index when navigating. Use when they ask about contents, chapters, or which page mentions something.",
      parameters: {
        type: "object",
        properties: {
          asset_id: { type: "string", description: "PDF asset id" },
          max_chars: { type: "number", description: "Max characters (default 14000)" },
        },
        required: ["asset_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_text_asset",
      description:
        "Read the text content of a source-code or plain-text file from the user's library (e.g. .py, .js, .ts, .sh). Use when they ask what a script does, to summarize code, or to answer questions about file contents.",
      parameters: {
        type: "object",
        properties: {
          asset_id: { type: "string", description: "Asset id from chat context code file list" },
          filename: {
            type: "string",
            description: "Exact filename such as main.py when asset_id is unknown",
          },
          max_chars: {
            type: "number",
            description: "Max characters to return (default 12000)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_library_folder",
      description:
        "Soft-delete a folder. Prefer folder_id from the instance folder snapshot. Alternatively pass library_slug + folder_name (exact name, case-insensitive match).",
      parameters: {
        type: "object",
        properties: {
          folder_id: { type: "string", description: "Folder id from chat context snapshot" },
          library_slug: { type: "string", description: "With folder_name if folder_id unknown" },
          folder_name: { type: "string", description: "With library_slug if folder_id unknown" },
        },
      },
    },
  },
] as const

function coalesceOptionalId(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function pickArgString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const s = coalesceOptionalId(args[key])
    if (s) return s
  }
  return undefined
}

type OllamaToolCall = {
  function?: { name?: string; arguments?: Record<string, unknown> | string }
}

export async function executeArciinChatTool(
  call: OllamaToolCall,
  ctx: ArciinChatToolContext,
): Promise<Record<string, unknown>> {
  const name = call.function?.name
  const rawArgs = call.function?.arguments
  const args =
    typeof rawArgs === "string"
      ? (JSON.parse(rawArgs) as Record<string, unknown>)
      : (rawArgs ?? {})
  const access: AiLibraryToolAccess = ctx.libraryToolAccess ?? "full"

  if (name === "vision_search_library") {
    const query = normalizeVisionSearchQuery(String(args.query ?? ""))
    if (!query) {
      return { error: "query is required" }
    }
    const maxResults = Math.min(5, Math.max(1, Number(args.maxResults) || 3))
    const candidates = await loadImageCandidatesForVision(ctx.prisma, ctx.storageRoot, 48, {
      queryHint: query,
    })
    const matches = await visionSearchLibraryImages({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      apiKey: ctx.apiKey,
      query,
      candidates,
      maxResults,
    })
    return {
      query,
      scanned: candidates.length,
      matches,
      displayTag:
        matches.length > 0
          ? `[[ASSETS:ids:${matches.map((m) => m.assetId).join(",")}]]`
          : null,
    }
  }

  if (name === "organize_images_library") {
    if (!libraryAllowsOrganize(access)) {
      return {
        error: "library_tool_policy",
        message:
          access === "vision_only"
            ? "Organize is disabled while library tools are set to read-only (vision only) in AI Security."
            : "Organize is disabled in Sandbox mode (AI Security). Create or delete folders is allowed; bulk organize is not.",
      }
    }
    const maxAssets = Math.min(30, Math.max(1, Number(args.maxAssets) || 20))
    const result = await organizeImagesLibrary({
      prisma: ctx.prisma,
      storageRoot: ctx.storageRoot,
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      apiKey: ctx.apiKey,
      userId: ctx.userId,
      maxAssets,
      publishRealtimeEvent: ctx.publishRealtimeEvent,
    })
    return {
      libraryName: result.libraryName,
      processed: result.processed,
      moved: result.results.filter((r) => r.status === "moved").length,
      skipped: result.results.filter((r) => r.status === "skipped").length,
      failed: result.results.filter((r) => r.status === "failed").length,
      results: result.results,
    }
  }

  if (name === "create_library_folder") {
    if (!libraryAllowsFolderMutations(access)) {
      return {
        error: "library_tool_policy",
        message:
          "Folder creation via chat is disabled while library tools are set to read-only (vision only) in AI Security.",
      }
    }
    const a = args as Record<string, unknown>
    const librarySlug = String(pickArgString(a, ["library_slug", "librarySlug"]) ?? "").toLowerCase().trim()
    const folderName = String(pickArgString(a, ["name", "folder_name", "folderName"]) ?? "").trim()
    const parentFolderId = coalesceOptionalId(pickArgString(a, ["parent_folder_id", "parentFolderId"]))
    if (!librarySlug || !folderName) {
      return { error: "validation", message: "library_slug and name are required." }
    }
    if (folderName.length > 100) {
      return { error: "validation", message: "Folder name must be at most 100 characters." }
    }

    const library = await ctx.prisma.library.findFirst({ where: { slug: librarySlug } })
    if (!library) {
      return { error: "library_not_found", library_slug: librarySlug }
    }

    let parent: { id: string; pathCache: string; libraryId: string } | null = null
    if (parentFolderId) {
      const p = await ctx.prisma.folder.findFirst({
        where: { id: parentFolderId, libraryId: library.id, deletedAt: null },
        select: { id: true, pathCache: true, libraryId: true },
      })
      if (!p) {
        return { error: "parent_not_found", parent_folder_id: parentFolderId }
      }
      parent = p
    }

    const slug = slugify(folderName)
    const pathCache = parent ? `${parent.pathCache}/${slug}` : slug

    try {
      const folder = await ctx.prisma.folder.create({
        data: {
          libraryId: library.id,
          parentFolderId: parent?.id ?? null,
          name: folderName,
          slug,
          pathCache,
        },
      })

      await recordAndBroadcastActivity(
        { prisma: ctx.prisma, publishRealtimeEvent: ctx.publishRealtimeEvent },
        {
        userId: ctx.userId,
        type: "folder.created",
        title: "Folder created",
        message: `${folder.name} was created.`,
        entityType: "folder",
        entityId: folder.id,
      },
    )

      return {
        success: true,
        folder: {
          id: folder.id,
          name: folder.name,
          pathCache: folder.pathCache,
          libraryId: library.id,
          library_slug: librarySlug,
        },
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "create_failed"
      return { error: "create_failed", message: msg }
    }
  }

  if (name === "read_pdf_asset") {
    const r = args as Record<string, unknown>
    const assetId = pickArgString(r, ["asset_id", "assetId"])
    if (!assetId) {
      return { error: "validation", message: "asset_id is required." }
    }
    return readPdfAssetContent(ctx.prisma, {
      assetId,
      maxChars: Number(r.max_chars ?? r.maxChars) || undefined,
    })
  }

  if (name === "read_text_asset") {
    const r = args as Record<string, unknown>
    return readTextAssetContent(ctx.prisma, {
      assetId: pickArgString(r, ["asset_id", "assetId"]),
      filename: pickArgString(r, ["filename", "name"]),
      maxChars: Number(r.max_chars ?? r.maxChars) || undefined,
    })
  }

  if (name === "delete_library_folder") {
    if (!libraryAllowsFolderMutations(access)) {
      return {
        error: "library_tool_policy",
        message:
          "Folder deletion via chat is disabled while library tools are set to read-only (vision only) in AI Security.",
      }
    }

    const d = args as Record<string, unknown>
    const folderIdArg = coalesceOptionalId(pickArgString(d, ["folder_id", "folderId"]))
    const libSlugArg = String(pickArgString(d, ["library_slug", "librarySlug"]) ?? "").toLowerCase().trim()
    const folderNameArg = String(pickArgString(d, ["folder_name", "folderName"]) ?? "").trim()

    let existing: { id: string; libraryId: string; pathCache: string; name: string } | null = null

    if (folderIdArg) {
      existing = await ctx.prisma.folder.findFirst({
        where: { id: folderIdArg, deletedAt: null },
        select: { id: true, libraryId: true, pathCache: true, name: true },
      })
    }

    if (!existing && libSlugArg && folderNameArg) {
      const library = await ctx.prisma.library.findFirst({ where: { slug: libSlugArg } })
      if (!library) {
        return { error: "library_not_found", library_slug: libSlugArg }
      }
      const matches = await ctx.prisma.folder.findMany({
        where: {
          libraryId: library.id,
          deletedAt: null,
          name: { equals: folderNameArg, mode: "insensitive" },
        },
        select: { id: true, libraryId: true, pathCache: true, name: true },
      })
      if (matches.length === 0) {
        return { error: "folder_not_found", library_slug: libSlugArg, folder_name: folderNameArg }
      }
      if (matches.length > 1) {
        return {
          error: "ambiguous",
          message: "Multiple folders matched that name; use folder_id from the snapshot.",
          candidates: matches.map((m) => ({ id: m.id, pathCache: m.pathCache, name: m.name })),
        }
      }
      existing = matches[0]!
    }

    if (!existing) {
      if (folderIdArg) {
        return {
          error: "folder_not_found",
          message:
            "No folder with that id. Prefer library_slug + folder_name from the chat context tree, or copy folder_id from the snapshot.",
          folder_id: folderIdArg,
        }
      }
      return {
        error: "validation",
        message: "Provide folder_id, or library_slug together with folder_name.",
      }
    }

    await ctx.prisma.folder.updateMany({
      where: {
        OR: [
          { id: existing.id },
          {
            libraryId: existing.libraryId,
            pathCache: { startsWith: `${existing.pathCache}/` },
          },
        ],
      },
      data: { deletedAt: new Date() },
    })

    await recordAndBroadcastActivity(
      { prisma: ctx.prisma, publishRealtimeEvent: ctx.publishRealtimeEvent },
      {
        userId: ctx.userId,
        type: "folder.deleted",
        title: "Folder deleted",
        message: `${existing.name} was removed.`,
        entityType: "folder",
        entityId: existing.id,
      },
    )

    return {
      success: true,
      deleted_folder_id: existing.id,
      name: existing.name,
    }
  }

  return { error: `Unknown tool: ${name ?? "?"}` }
}
