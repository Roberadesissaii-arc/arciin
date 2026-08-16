import type { Prisma, PrismaClient } from "@prisma/client"
import { nanoid } from "nanoid"
import type { AiLibraryToolAccess } from "@arciin/shared"
import {
  DELIVERY_CHAT_TOOLS,
  libraryAllowsFolderMutations,
  libraryAllowsOrganize,
  matchAssetByName,
  type DeliveryChannel,
} from "@arciin/shared"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { organizeImagesLibrary } from "@/services/chat/organize-images-library"
import {
  loadImageCandidatesForVision,
  normalizeVisionSearchQuery,
  visionSearchLibraryImages,
} from "@/services/chat/vision-library"
import { readPdfAssetContent } from "@/services/chat/read-pdf-asset"
import { readTextAssetContent } from "@/services/chat/read-text-asset"
import {
  findAssetsByExactName,
  MAX_MOVES_PER_BATCH,
  moveLibraryAssets,
} from "@/services/assets/move-library-assets"
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
  /**
   * Sends a library file to the *owner's own* configured email or Discord.
   * Injected rather than imported so this module keeps no Fastify dependency —
   * and note the signature: no destination. See delivery-policy for why.
   */
  deliverAsset?: (input: {
    channel: DeliveryChannel
    assetId: string
    note: string | null
  }) => Promise<
    | { ok: true; channel: DeliveryChannel; filename: string; destination: string }
    | { ok: false; code: string; message: string }
  >
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
  // Defined in @arciin/shared beside the rule they obey: no destination argument.
  ...DELIVERY_CHAT_TOOLS,
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
  {
    type: "function",
    function: {
      name: "list_app_database_tables",
      description:
        "List the tables inside one of the user's App data databases (logical JSON stores, separate from library files), with row counts. Use this whenever the user asks what tables or databases they have, or before adding data so you know what already exists — do not guess table names.",
      parameters: {
        type: "object",
        properties: {
          database_name: {
            type: "string",
            description: "App database name or slug. Omit if the user only has one — it will be used automatically.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_app_database_rows",
      description:
        "Insert one or more rows into a table in one of the user's App data databases. Creates the table automatically if it doesn't exist yet. Use ONLY when the user names a database or table and wants structured records added — orders, contacts, seed/test data. NEVER use this to store prose: a note, essay, summary, report, or study guide is written directly in your reply, not saved as rows. \"Canvas\" is Arciin's writing panel, never a database — if the user says canvas, write the document in your reply.",
      parameters: {
        type: "object",
        properties: {
          database_name: {
            type: "string",
            description: "App database name or slug. Omit if the user only has one — it will be used automatically.",
          },
          table_name: {
            type: "string",
            description: "Table name, e.g. \"orders\". Created automatically if it doesn't already exist.",
          },
          rows: {
            type: "array",
            description:
              "Rows to insert. Each row is a JSON object of field/value pairs you choose based on what the table is for. Optionally include a \"_name\" field per row to set its display name; otherwise one is generated.",
            items: { type: "object" },
          },
        },
        required: ["table_name", "rows"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_library_file",
      description:
        "Look up a file by its EXACT filename to get its canonical id. Use this when a move failed with asset_not_found — never retype or repair an id by hand. Returns matching_count so you can tell a unique file from an ambiguous one; only act when matching_count is 1.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact filename, e.g. \"Chess For Dummies (James Eade).pdf\"",
          },
          library_slug: {
            type: "string",
            description: "videos | images | music | documents | inbox. Narrows the search.",
          },
          folder_id: {
            type: "string",
            description: "Only look inside this folder.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_library_files",
      description:
        "List files in a library or folder, one page at a time. Use this whenever the user says \"all\", \"every\", or \"the whole folder\" — the instance snapshot in your context is only a short preview and is NOT the full library. Returns has_more and next_cursor: keep calling with the returned cursor until has_more is false, then you have every file. Also use it after moving files to verify they actually arrived.",
      parameters: {
        type: "object",
        properties: {
          library_slug: {
            type: "string",
            description: "videos | images | music | documents | inbox",
          },
          folder_id: {
            type: "string",
            description:
              "Only files directly inside this folder. Omit to list the whole library.",
          },
          root_only: {
            type: "boolean",
            description: "Only files not in any folder yet (library root). Useful before organising.",
          },
          cursor: {
            type: "string",
            description: "next_cursor from the previous page. Omit for the first page.",
          },
          limit: {
            type: "number",
            description: "Files per page, 1-200 (default 100).",
          },
        },
        required: ["library_slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_library_files",
      description:
        "Actually move one or many files into folders. This performs the move — it is not a suggestion, and you should never tell the user to drag files themselves when you can call this. Use it to organise a library: create or find the folders first, then move files into them by id. Files already in their destination are reported as already_there and left alone, so it is safe to run twice. Moves files only, never folders. Include each file's filename as well as its id: a wrong id is then recovered automatically rather than losing the file. Returns a per-file result so you can report exactly what succeeded and what needs attention.",
      parameters: {
        type: "object",
        properties: {
          moves: {
            type: "array",
            description: "Up to 250 moves per call. Split larger jobs across several calls.",
            items: {
              type: "object",
              properties: {
                asset_id: {
                  type: "string",
                  description:
                    "File id, copied EXACTLY as list_library_files returned it. Ids are opaque — never retype, shorten or correct one.",
                },
                destination_folder_id: {
                  type: "string",
                  description:
                    "Folder id to move it into. Use null to move it back to the library root.",
                },
                filename: {
                  type: "string",
                  description:
                    "The file's exact name. Optional but recommended: if the id turns out to be wrong, Arciin re-finds the file by this name and completes the move, instead of leaving it behind.",
                },
              },
              required: ["asset_id", "destination_folder_id"],
            },
          },
        },
        required: ["moves"],
      },
    },
  },
] as const

async function ensureAppDatabaseFeatureEnabled(
  ctx: ArciinChatToolContext,
): Promise<{ error: string; message: string } | null> {
  const [{ hasFeature, plansWithFeature }, licenseService] = await Promise.all([
    import("@arciin/shared"),
    import("@/services/license/license-service"),
  ])
  const snapshot = await licenseService.loadLicenseSnapshot(ctx.prisma)
  if (hasFeature(snapshot, "developer.app_databases")) return null
  const needed = plansWithFeature("developer.app_databases")
  return {
    error: "license_required",
    message: `App data databases require a higher Arciin plan (${needed.join(", ")}).`,
  }
}

async function resolveAppDatabaseByName(
  ctx: ArciinChatToolContext,
  databaseName?: string,
): Promise<
  | { database: { id: string; name: string; slug: string } }
  | { error: string; message: string; available?: string[] }
> {
  const where = databaseName
    ? {
        OR: [
          { name: { equals: databaseName, mode: "insensitive" as const } },
          { slug: slugify(databaseName) },
        ],
      }
    : {}
  const matches = await ctx.prisma.appDatabase.findMany({
    where,
    select: { id: true, name: true, slug: true },
    take: 10,
  })

  if (matches.length === 1) return { database: matches[0]! }

  if (matches.length === 0) {
    const all = await ctx.prisma.appDatabase.findMany({ select: { name: true }, take: 20 })
    return {
      error: databaseName ? "database_not_found" : "no_databases",
      message: databaseName
        ? `No app database named "${databaseName}". Available: ${all.map((d) => d.name).join(", ") || "none"}.`
        : "No app databases exist yet. Create one in App data databases first.",
      available: all.map((d) => d.name),
    }
  }

  return {
    error: "ambiguous_database",
    message: `Multiple app databases matched — specify database_name. Options: ${matches
      .map((d) => d.name)
      .join(", ")}.`,
  }
}

async function resolveAppDatabaseTable(
  ctx: ArciinChatToolContext,
  databaseId: string,
  tableName: string,
  createIfMissing: boolean,
): Promise<
  | { folder: { id: string; name: string }; created: boolean }
  | { error: string; message: string }
> {
  const existing = await ctx.prisma.appDatabaseFolder.findFirst({
    where: { databaseId, deletedAt: null, name: { equals: tableName, mode: "insensitive" } },
    select: { id: true, name: true },
  })
  if (existing) return { folder: existing, created: false }

  if (!createIfMissing) {
    return { error: "table_not_found", message: `No table named "${tableName}" in this database.` }
  }

  const slug = slugify(tableName) || "table"
  const folder = await ctx.prisma.appDatabaseFolder.create({
    data: { databaseId, name: tableName, slug, pathCache: slug },
    select: { id: true, name: true },
  })
  return { folder, created: true }
}

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


/**
 * Turn "send me invoice.pdf" into a specific asset id.
 *
 * Refuses on ambiguity rather than guessing. Sending the wrong file to someone's
 * inbox or a Discord channel is not an action they can take back, so a
 * clarifying question is strictly better than a confident mistake.
 */
async function resolveDeliverableAsset(
  ctx: ArciinChatToolContext,
  input: { assetId?: string | null; filename?: string | null },
): Promise<{ assetId?: string; error?: Record<string, unknown> }> {
  if (input.assetId) {
    const asset = await ctx.prisma.asset.findFirst({
      where: { id: input.assetId, deletedAt: null },
      select: { id: true },
    })
    if (!asset) {
      return { error: { error: "asset_not_found", message: "I could not find that file." } }
    }
    return { assetId: asset.id }
  }

  if (!input.filename) {
    return {
      error: {
        error: "validation",
        message: "Tell me which file you want sent — a filename works.",
      },
    }
  }

  // Bounded scan of recent files rather than a LIKE across the whole library:
  // the user is almost always referring to something they have just seen.
  const candidates = await ctx.prisma.asset.findMany({
    where: { deletedAt: null, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: { id: true, originalFilename: true, title: true },
  })

  const match = matchAssetByName(input.filename, candidates)

  if (match.status === "matched") return { assetId: match.asset.id }

  if (match.status === "ambiguous") {
    return {
      error: {
        error: "asset_ambiguous",
        message: "Several files match that name — which one?",
        candidates: match.candidates.map((c) => c.originalFilename),
      },
    }
  }

  return {
    error: {
      error: "asset_not_found",
      message: `I could not find a file called ${input.filename}.`,
    },
  }
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

  if (name === "find_library_file") {
    const a = args as Record<string, unknown>
    const wanted = (pickArgString(a, ["name", "filename", "file_name"]) ?? "").trim()
    if (!wanted) {
      return { error: "validation", message: "name is required." }
    }
    const librarySlug = (pickArgString(a, ["library_slug", "librarySlug"]) ?? "")
      .toLowerCase()
      .trim()
    const folderId = coalesceOptionalId(pickArgString(a, ["folder_id", "folderId"]))

    const library = librarySlug
      ? await ctx.prisma.library.findFirst({ where: { slug: librarySlug }, select: { id: true } })
      : null
    if (librarySlug && !library) return { error: "library_not_found", library_slug: librarySlug }

    const matches = await findAssetsByExactName(ctx.prisma, {
      name: wanted,
      libraryId: library?.id,
      folderId,
    })

    return {
      query: wanted,
      matching_count: matches.length,
      // Unique is the only case a caller may act on without asking. Anything
      // else is reported and left alone — see the move recovery path.
      unique: matches.length === 1,
      items: matches.map((m) => ({
        asset_id: m.id,
        filename: m.originalFilename,
        size_bytes: Number(m.sizeBytes),
        folder_id: m.folderId,
        folder: m.folderName,
      })),
    }
  }

  if (name === "list_library_files") {
    const a = args as Record<string, unknown>
    const librarySlug = String(pickArgString(a, ["library_slug", "librarySlug"]) ?? "")
      .toLowerCase()
      .trim()
    if (!librarySlug) {
      return { error: "validation", message: "library_slug is required." }
    }
    const library = await ctx.prisma.library.findFirst({
      where: { slug: librarySlug },
      select: { id: true, slug: true, name: true },
    })
    if (!library) return { error: "library_not_found", library_slug: librarySlug }

    const folderId = coalesceOptionalId(pickArgString(a, ["folder_id", "folderId"]))
    const rootOnly = a.root_only === true || a.rootOnly === true
    const cursor = coalesceOptionalId(pickArgString(a, ["cursor", "next_cursor", "nextCursor"]))
    const limit = Math.min(200, Math.max(1, Number(a.limit) || 100))

    if (folderId) {
      const folder = await ctx.prisma.folder.findFirst({
        where: { id: folderId, libraryId: library.id, deletedAt: null },
        select: { id: true, lockedAt: true },
      })
      if (!folder) return { error: "folder_not_found", folder_id: folderId }
      // A locked folder is not listable by the assistant for the same reason it
      // is not writable: the lock is answered by a person, not by a tool.
      if (folder.lockedAt !== null) {
        return { error: "folder_locked", folder_id: folderId }
      }
    }

    const where = {
      libraryId: library.id,
      deletedAt: null,
      ...(folderId ? { folderId } : {}),
      ...(rootOnly && !folderId ? { folderId: null } : {}),
    }

    const [total, rows] = await Promise.all([
      ctx.prisma.asset.count({ where }),
      ctx.prisma.asset.findMany({
        where,
        // Stable order so a cursor walk cannot skip or repeat a file while the
        // library is being reorganised underneath it.
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit,
        select: {
          id: true,
          originalFilename: true,
          title: true,
          mediaType: true,
          extension: true,
          sizeBytes: true,
          folderId: true,
          createdAt: true,
        },
      }),
    ])

    const lockedFolderIds = new Set(
      (
        await ctx.prisma.folder.findMany({
          where: { libraryId: library.id, lockedAt: { not: null } },
          select: { id: true },
        })
      ).map((f) => f.id),
    )
    const visible = rows.filter((r) => !r.folderId || !lockedFolderIds.has(r.folderId))

    const last = rows[rows.length - 1]
    const hasMore = rows.length === limit
    return {
      library: { id: library.id, slug: library.slug, name: library.name },
      total,
      returned: visible.length,
      has_more: hasMore,
      next_cursor: hasMore && last ? last.id : null,
      items: visible.map((r) => ({
        asset_id: r.id,
        filename: r.originalFilename,
        title: r.title,
        media_type: r.mediaType,
        extension: r.extension,
        size_bytes: Number(r.sizeBytes),
        // Surfaced rather than hidden: a zero-byte file is very often a failed
        // upload, and quietly filing it as a book buries the problem.
        is_empty: Number(r.sizeBytes) === 0,
        folder_id: r.folderId,
      })),
    }
  }

  if (name === "move_library_files") {
    if (!libraryAllowsOrganize(access)) {
      return {
        error: "forbidden",
        message:
          "Moving library files is disabled for the assistant on this instance (Settings → AI Security → Library tools).",
      }
    }

    const a = args as Record<string, unknown>
    const rawMoves = Array.isArray(a.moves) ? a.moves : []
    if (rawMoves.length === 0) {
      return { error: "validation", message: "moves must contain at least one file." }
    }
    if (rawMoves.length > MAX_MOVES_PER_BATCH) {
      return {
        error: "too_many",
        message: `Move at most ${MAX_MOVES_PER_BATCH} files per call; split the rest into further calls.`,
        max_per_call: MAX_MOVES_PER_BATCH,
      }
    }

    const moves: { assetId: string; destinationFolderId: string | null }[] = []
    for (const raw of rawMoves) {
      const item = (raw ?? {}) as Record<string, unknown>
      const assetId = coalesceOptionalId(pickArgString(item, ["asset_id", "assetId", "file_id"]))
      // Models paraphrase argument names. A real turn sent `target_folder_id`,
      // which would otherwise have read as "no destination" and moved the file
      // to the library root — the opposite of what was asked.
      const destination = coalesceOptionalId(
        pickArgString(item, [
          "destination_folder_id",
          "destinationFolderId",
          "target_folder_id",
          "targetFolderId",
          "folder_id",
          "folderId",
          "to_folder_id",
        ]),
      )
      if (!assetId) {
        return { error: "validation", message: "Every move needs an asset_id." }
      }
      // Optional, and worth having: it is what lets a mistyped id be recovered
      // instead of quietly leaving the file behind.
      const filename = pickArgString(item, ["filename", "file_name", "name"])
      moves.push({
        assetId,
        destinationFolderId: destination ?? null,
        ...(filename ? { filename } : {}),
      })
    }

    const result = await moveLibraryAssets({
      prisma: ctx.prisma,
      userId: ctx.userId,
      moves,
      publishRealtimeEvent: ctx.publishRealtimeEvent,
      source: "chat_ai",
    })

    return {
      success: result.failed === 0,
      operation_id: result.operationId,
      moved: result.moved,
      already_there: result.alreadyThere,
      failed: result.failed,
      recovered_by_name: result.recovered,
      // Only the interesting rows come back. A model that receives 246 "moved"
      // lines tends to read them out one by one, which is exactly the flood the
      // single progress summary exists to avoid.
      failures: result.results
        .filter((r) => r.status === "failed")
        .map((r) => ({ asset_id: r.assetId, filename: r.filename, code: r.code, message: r.message })),
      name_collisions: result.results
        .filter((r) => r.nameCollision)
        .map((r) => ({ asset_id: r.assetId, filename: r.filename })),
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

  if (name === "send_asset_to_email" || name === "send_asset_to_discord") {
    const channel = name === "send_asset_to_email" ? "email" : "discord"
    const a = args as Record<string, unknown>
    const assetId = coalesceOptionalId(pickArgString(a, ["asset_id", "assetId"]))
    const filename = pickArgString(a, ["filename", "file_name", "name"])
    const note = pickArgString(a, ["note", "message"])

    if (!ctx.deliverAsset) {
      return {
        error: "unavailable",
        message: "Sending files is not available in this chat session.",
      }
    }

    const resolved = await resolveDeliverableAsset(ctx, { assetId, filename })
    if (resolved.error) return resolved.error

    const result = await ctx.deliverAsset({
      channel,
      assetId: resolved.assetId!,
      note: note ?? null,
    })

    if (!result.ok) {
      return { error: result.code, message: result.message }
    }

    return {
      sent: true,
      channel,
      filename: result.filename,
      // The masked destination is for the user's confirmation. The model is
      // told where it went in general terms only — see delivery-policy.
      destination: result.destination,
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
      maxPages: Number(r.max_pages ?? r.maxPages) || undefined,
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

  if (name === "list_app_database_tables") {
    const featureError = await ensureAppDatabaseFeatureEnabled(ctx)
    if (featureError) return featureError

    const a = args as Record<string, unknown>
    const resolved = await resolveAppDatabaseByName(ctx, pickArgString(a, ["database_name", "databaseName"]))
    if ("error" in resolved) return resolved

    const tables = await ctx.prisma.appDatabaseFolder.findMany({
      where: { databaseId: resolved.database.id, deletedAt: null },
      orderBy: { pathCache: "asc" },
      include: { _count: { select: { records: true } } },
      take: 200,
    })

    return {
      database: resolved.database,
      tables: tables.map((t) => ({
        id: t.id,
        name: t.name,
        row_count: t._count.records,
      })),
    }
  }

  if (name === "add_app_database_rows") {
    if (!libraryAllowsFolderMutations(access)) {
      return {
        error: "library_tool_policy",
        message:
          "Adding data via chat is disabled while library tools are set to read-only (vision only) in AI Security.",
      }
    }

    const featureError = await ensureAppDatabaseFeatureEnabled(ctx)
    if (featureError) return featureError

    const a = args as Record<string, unknown>
    const tableName = String(pickArgString(a, ["table_name", "tableName"]) ?? "").trim()
    const rowsInput = Array.isArray(a.rows) ? a.rows : null

    if (!tableName) {
      return { error: "validation", message: "table_name is required." }
    }
    if (!rowsInput || rowsInput.length === 0) {
      return { error: "validation", message: "rows must be a non-empty array of objects." }
    }
    if (rowsInput.length > 50) {
      return { error: "validation", message: "Add at most 50 rows per call." }
    }

    const resolved = await resolveAppDatabaseByName(ctx, pickArgString(a, ["database_name", "databaseName"]))
    if ("error" in resolved) return resolved

    const tableResult = await resolveAppDatabaseTable(ctx, resolved.database.id, tableName, true)
    if ("error" in tableResult) return tableResult

    const inserted: Array<{ id: string; name: string }> = []
    const failed: Array<{ index: number; error: string }> = []

    for (let i = 0; i < rowsInput.length; i += 1) {
      const row = rowsInput[i]
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        failed.push({ index: i, error: "row must be a JSON object" })
        continue
      }
      const rowRecord = { ...(row as Record<string, unknown>) }
      const explicitName = coalesceOptionalId(rowRecord._name)
      delete rowRecord._name

      try {
        const record = await ctx.prisma.appDatabaseRecord.create({
          data: {
            folderId: tableResult.folder.id,
            name: explicitName ?? nanoid(),
            payload: rowRecord as Prisma.InputJsonValue,
          },
          select: { id: true, name: true },
        })
        inserted.push(record)
      } catch (e) {
        failed.push({ index: i, error: e instanceof Error ? e.message : "insert_failed" })
      }
    }

    return {
      success: failed.length === 0,
      database: resolved.database,
      table: { id: tableResult.folder.id, name: tableResult.folder.name, created: tableResult.created },
      inserted_count: inserted.length,
      inserted,
      failed,
    }
  }

  return { error: `Unknown tool: ${name ?? "?"}` }
}
