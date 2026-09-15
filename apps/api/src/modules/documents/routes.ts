import { readFile } from "node:fs/promises"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  extractPdfMetadataFromBytes,
  isCodeFilename,
  isPdfFilenameOrMime,
} from "@arciin/shared"
import {
  GeminiNotConfiguredError,
  resolveGeminiMediaConfig,
  suggestDocumentSummary,
  suggestTitles,
} from "@arciin/media-ai"

import { friendlyGeminiErrorMessage } from "@/services/ai/friendly-gemini-error"
import { readPdfAssetContent } from "@/services/chat/read-pdf-asset"
import { readTextAssetContent } from "@/services/chat/read-text-asset"
import { assertAssetFolderAccess } from "@/services/folders/folder-lock"
import { AI_RATE_LIMITS, checkAiRateLimit } from "@/services/security/endpoint-rate-limit"
import { requireFeature, requireSessionRole } from "@/services/security/auth"
import { serializeAsset } from "@/services/serializers"

/**
 * Document Assist: PDF metadata backfill + summarize.
 *
 * Metadata is normally filled on upload. Older files call
 * POST …/document-metadata once. Summarize extracts text via pdfjs, asks Gemini,
 * and stores documentInsight on the Asset row.
 */
export async function registerDocumentRoutes(fastify: FastifyInstance) {
  const guard = [requireSessionRole(["OWNER", "ADMIN", "MEMBER"])]
  /** Document Assist tools share the AI Chat Pro gate. */
  const assistGuard = [
    requireSessionRole(["OWNER", "ADMIN", "MEMBER"]),
    requireFeature("ai.chat"),
  ]

  async function loadAccessibleAsset(
    request: FastifyRequest,
    reply: FastifyReply,
    assetId: string,
  ) {
    const asset = await fastify.prisma.asset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: { storageObject: true },
    })
    if (!asset) {
      reply.status(404).send({
        error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
      })
      return null
    }
    if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
      return null
    }
    return asset
  }

  function isPdfAssistAsset(asset: {
    mediaType: string
    originalFilename: string
    mimeType: string | null
  }) {
    return (
      asset.mediaType === "DOCUMENT" &&
      isPdfFilenameOrMime(asset.originalFilename, asset.mimeType)
    )
  }

  function isCodeAssistAsset(asset: {
    mediaType: string
    originalFilename: string
  }) {
    return asset.mediaType === "CODE" || isCodeFilename(asset.originalFilename)
  }

  type AssistSource =
    | { ok: true; kind: "pdf" | "code"; text: string; numPages: number | null }
    | { ok: false }

  async function loadAssistSource(
    reply: FastifyReply,
    asset: {
      id: string
      mediaType: string
      originalFilename: string
      mimeType: string | null
    },
    limits: { maxChars: number; maxPages: number },
  ): Promise<AssistSource> {
    if (isPdfAssistAsset(asset)) {
      const pdf = await readPdfAssetContent(fastify.prisma, {
        assetId: asset.id,
        maxChars: limits.maxChars,
        maxPages: limits.maxPages,
      })
      if ("error" in pdf && pdf.error) {
        reply.status(409).send({
          error: {
            code: String(pdf.error).toUpperCase(),
            message: typeof pdf.message === "string" ? pdf.message : "Could not read PDF text.",
          },
        })
        return { ok: false }
      }
      const text = typeof pdf.content === "string" ? pdf.content : ""
      if (!text.trim()) {
        reply.status(409).send({
          error: { code: "NO_TEXT", message: "No extractable text was found in this PDF." },
        })
        return { ok: false }
      }
      return {
        ok: true,
        kind: "pdf",
        text,
        numPages: typeof pdf.num_pages === "number" ? pdf.num_pages : null,
      }
    }

    if (isCodeAssistAsset(asset)) {
      const source = await readTextAssetContent(fastify.prisma, {
        assetId: asset.id,
        maxChars: limits.maxChars,
      })
      if ("error" in source && source.error) {
        reply.status(409).send({
          error: {
            code: String(source.error).toUpperCase(),
            message:
              typeof source.message === "string" ? source.message : "Could not read this file.",
          },
        })
        return { ok: false }
      }
      const text = typeof source.content === "string" ? source.content : ""
      if (!text.trim()) {
        reply.status(409).send({
          error: { code: "NO_TEXT", message: "No readable text was found in this file." },
        })
        return { ok: false }
      }
      return { ok: true, kind: "code", text, numPages: null }
    }

    reply.status(409).send({
      error: {
        code: "NOT_ASSISTABLE",
        message: "Summarize and titles are available for PDFs and source files.",
      },
    })
    return { ok: false }
  }

  /**
   * Fill pageCount / author / subject for PDFs uploaded before extraction
   * existed, or when extraction failed the first time.
   */
  fastify.post(
    "/assets/:assetId/document-metadata",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      if (
        asset.mediaType !== "DOCUMENT" ||
        !isPdfFilenameOrMime(asset.originalFilename, asset.mimeType)
      ) {
        reply.status(409).send({
          error: {
            code: "NOT_PDF",
            message: "Document metadata extraction is available for PDFs.",
          },
        })
        return
      }

      if (asset.pageCount != null) {
        reply.send({ data: serializeAsset(asset) })
        return
      }

      const path = asset.storageObject?.physicalPath
      if (!path) {
        reply.status(409).send({
          error: { code: "NO_STORAGE", message: "File content is not on disk." },
        })
        return
      }

      try {
        const bytes = new Uint8Array(await readFile(path))
        const pdf = await extractPdfMetadataFromBytes(bytes)
        const updated = await fastify.prisma.asset.update({
          where: { id: assetId },
          data: {
            ...(pdf.pageCount != null ? { pageCount: pdf.pageCount } : {}),
            ...(pdf.author ? { documentAuthor: pdf.author } : {}),
            ...(pdf.subject ? { documentSubject: pdf.subject } : {}),
            ...(pdf.title && !asset.title ? { title: pdf.title } : {}),
          },
        })
        reply.send({ data: serializeAsset(updated) })
      } catch (error) {
        reply.status(502).send({
          error: {
            code: "METADATA_FAILED",
            message: error instanceof Error ? error.message : "Could not read PDF metadata.",
          },
        })
      }
    },
  )

  /**
   * Short title suggestions from PDF text (1–2 words), same rules as video titles.
   * Never renames — Apply goes through the normal asset update.
   */
  fastify.post(
    "/assets/:assetId/document-title-suggestions",
    { preHandler: assistGuard },
    async (request, reply) => {
      if (await checkAiRateLimit(request, reply, AI_RATE_LIMITS.title)) return

      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const body = z
        .object({
          profileId: z.string().optional(),
          count: z.number().int().min(1).max(6).optional(),
        })
        .safeParse(request.body ?? {})

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const source = await loadAssistSource(reply, asset, { maxChars: 16_000, maxPages: 20 })
      if (!source.ok) return

      let config
      try {
        config = await resolveGeminiMediaConfig(
          fastify.prisma,
          body.success ? body.data.profileId : undefined,
        )
      } catch (error) {
        if (error instanceof GeminiNotConfiguredError) {
          reply.status(409).send({
            error: {
              code: "GEMINI_NOT_CONFIGURED",
              message: "Add a Gemini model profile under Models to suggest titles.",
            },
          })
          return
        }
        throw error
      }

      try {
        const result = await suggestTitles({
          config,
          transcriptText: source.text,
          count: body.success ? body.data.count : undefined,
          kind: source.kind === "code" ? "code" : "video",
          filename: asset.originalFilename,
        })
        reply.send({ data: { titles: result.titles, model: result.model } })
      } catch (error) {
        const friendly = friendlyGeminiErrorMessage(error, "The model did not return titles.")
        reply.status(502).send({
          error: {
            code: friendly.code === "AI_FAILED" ? "TITLE_FAILED" : friendly.code,
            message: friendly.message,
          },
        })
      }
    },
  )

  fastify.post(
    "/assets/:assetId/document-summary",
    { preHandler: assistGuard },
    async (request, reply) => {
      if (await checkAiRateLimit(request, reply, AI_RATE_LIMITS.summary)) return

      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const body = z
        .object({ profileId: z.string().optional() })
        .safeParse(request.body ?? {})

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const source = await loadAssistSource(reply, asset, { maxChars: 24_000, maxPages: 40 })
      if (!source.ok) return

      if (asset.pageCount == null && source.numPages != null) {
        await fastify.prisma.asset.update({
          where: { id: assetId },
          data: { pageCount: source.numPages },
        })
      }

      let config
      try {
        config = await resolveGeminiMediaConfig(
          fastify.prisma,
          body.success ? body.data.profileId : undefined,
        )
      } catch (error) {
        if (error instanceof GeminiNotConfiguredError) {
          reply.status(409).send({
            error: {
              code: "GEMINI_NOT_CONFIGURED",
              message: "Add a Gemini model profile under Models to summarize documents.",
            },
          })
          return
        }
        throw error
      }

      try {
        const result = await suggestDocumentSummary({
          config,
          documentText: source.text,
          filename: asset.originalFilename,
          kind: source.kind === "code" ? "code" : "document",
        })
        const generatedAt = new Date().toISOString()
        const documentInsight = {
          summary: result.summary,
          keywords: result.keywords,
          links: result.links,
          about: result.about,
          topics: result.topics,
          model: result.model,
          generatedAt,
        }
        await fastify.prisma.asset.update({
          where: { id: assetId },
          data: { documentInsight },
        })
        reply.send({ data: documentInsight })
      } catch (error) {
        const friendly = friendlyGeminiErrorMessage(error, "The model did not return a summary.")
        reply.status(502).send({
          error: {
            code: friendly.code === "AI_FAILED" ? "SUMMARY_FAILED" : friendly.code,
            message: friendly.message,
          },
        })
      }
    },
  )
}
