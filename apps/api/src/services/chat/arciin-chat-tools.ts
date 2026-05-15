import type { PrismaClient } from "@prisma/client"

import { organizeImagesLibrary } from "@/services/chat/organize-images-library"
import {
  loadImageCandidatesForVision,
  normalizeVisionSearchQuery,
  visionSearchLibraryImages,
} from "@/services/chat/vision-library"

export type ArciinChatToolContext = {
  prisma: PrismaClient
  storageRoot: string | null | undefined
  baseUrl: string
  model: string
  userId: string
  readOnlyTools?: boolean
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
] as const

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
    if (ctx.readOnlyTools) {
      return {
        error: "read_only_tools",
        message: "Organize is disabled while read-only library tools are enabled in AI Security settings.",
      }
    }
    const maxAssets = Math.min(30, Math.max(1, Number(args.maxAssets) || 20))
    const result = await organizeImagesLibrary({
      prisma: ctx.prisma,
      storageRoot: ctx.storageRoot,
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      userId: ctx.userId,
      maxAssets,
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

  return { error: `Unknown tool: ${name ?? "?"}` }
}
