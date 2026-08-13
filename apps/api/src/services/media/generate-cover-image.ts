/**
 * A cover image for a document, drawn from what the document is about.
 *
 * A shelf of PDFs all rendered as their own first page looks like a shelf of
 * grey rectangles: the thing that tells them apart is the one thing too small
 * to read. This reads the file, works out what it is, and asks an image model
 * for a cover — which then takes the place of the page render.
 *
 * The result is written to the same path the thumbnail pipeline already serves
 * from, so nothing downstream needs to know a cover is a different kind of
 * thing. Regenerating simply overwrites it, and deleting the file falls back to
 * the page render on the next request.
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import {
  buildCoverBriefInstruction,
  buildCoverPrompt,
  buildCoverPromptFromBrief,
  isUsableCoverBrief,
  sanitizeDocumentExcerpt,
  wrapUntrustedExcerpt,
} from "@arciin/shared"

import { readPdfAssetContent } from "@/services/chat/read-pdf-asset"
import { decryptModelApiKey } from "@/services/security/model-profile-key-crypto"
import { resolvedThumbnailPath } from "@/services/media/thumbnail-cache"

/**
 * Only follow an image URL that is plainly public.
 *
 * The service returns a URL we then fetch server-side, which is remote input
 * driving a server-side request. A compromised or misconfigured endpoint could
 * point it at the metadata service or something else on the private network and
 * have the reply stored as an image. Base64 is requested precisely so this path
 * is rarely used; when it is, it must be https and must not resolve to a
 * literal private or loopback address.
 */
function isSafeImageUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false
  // Literal addresses only — a DNS name that resolves inward is not something a
  // string check can catch, which is why https and the allow-list above matter.
  if (/^\[?(::1|fe80:|fc00:|fd)/i.test(host)) return false
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10 || a === 0 || a === 169) return false
    if (a === 192 && b === 168) return false
    if (a === 172 && b >= 16 && b <= 31) return false
  }
  return true
}

/** xAI's image endpoint is OpenAI-shaped and lives on the same base. */
const XAI_IMAGE_PATH = "/images/generations"
const IMAGE_MODEL = "grok-imagine-image-quality"
const REQUEST_TIMEOUT_MS = 90_000

export type CoverResult =
  | { ok: true; prompt: string }
  | { ok: false; code: string; message: string }

/**
 * Find a key for the image API.
 *
 * Reuses whatever Grok profile the instance already has rather than adding a
 * second place to keep an xAI key: a key configured twice is a key that goes
 * stale in one of them.
 */
async function resolveImageCredentials(
  prisma: FastifyInstance["prisma"],
): Promise<{ apiKey: string; baseUrl: string } | null> {
  const profile = await prisma.modelProfile.findFirst({
    where: { provider: "grok", isEnabled: true },
    orderBy: { isDefault: "desc" },
    select: { apiKey: true, baseUrl: true },
  })
  const apiKey = decryptModelApiKey(profile?.apiKey ?? null)
  if (!apiKey) return null

  const raw = (profile?.baseUrl || "https://api.x.ai/v1").replace(/\/+$/, "")
  const baseUrl = raw.endsWith("/v1") ? raw : `${raw}/v1`
  return { apiKey, baseUrl }
}

/**
 * Drop the reader's own instructions from the extracted text.
 *
 * `readPdfAssetContent` prefixes the page text with guidance written for the
 * chat model — how to read the status bar, which tag to use for a page jump.
 * Handed to an image model that reads as part of the document, so a cover was
 * being drawn partly from instructions about [goto-page:N].
 */
function stripReaderPreamble(content: string): string {
  const firstPage = content.indexOf("--- PDF page")
  const body = firstPage >= 0 ? content.slice(firstPage) : content
  return body.replace(/^---\s*PDF page[^\n]*\n?/gm, " ").trim()
}

/**
 * Ask the instance's own chat model what this document should look like.
 *
 * Uses whichever text model is already configured rather than requiring a
 * second one, and fails quietly: a cover drawn from the raw excerpt is worth
 * more than no cover.
 */
async function writeCoverBrief(
  fastify: FastifyInstance,
  filename: string,
  excerpt: string,
): Promise<string | null> {
  if (!excerpt.trim()) return null

  const profile = await fastify.prisma.modelProfile.findFirst({
    where: { isEnabled: true },
    orderBy: { isDefault: "desc" },
    select: { apiKey: true, baseUrl: true, defaultModel: true, provider: true },
  })
  const apiKey = decryptModelApiKey(profile?.apiKey ?? null)
  const baseUrl = (profile?.baseUrl || "").replace(/\/+$/, "")
  if (!apiKey || !baseUrl || !profile?.defaultModel) return null

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: profile.defaultModel,
        stream: false,
        // One sentence out; the ceiling is generous enough for a reasoning
        // model to think and still answer.
        max_tokens: 600,
        messages: [
          { role: "system", content: buildCoverBriefInstruction(filename) },
          { role: "user", content: wrapUntrustedExcerpt(excerpt) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return null
    // Take the last non-empty line: a chatty model prefixes its answer.
    const line = text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1)
    // The model has just read attacker-controlled text, so its answer is checked
    // rather than trusted. A rejected brief falls back to the direct prompt,
    // which is built from sanitised text and fixed rules.
    return line && isUsableCoverBrief(line) ? line : null
  } catch {
    return null
  }
}

/**
 * Draw one image from a prompt the caller already has.
 *
 * Shares the credential lookup and the request shape with covers so there is one
 * place that knows how to reach the image API — a second copy is a second thing
 * to fix when the endpoint or the model name moves.
 */
export async function generateImageFromPrompt(
  fastify: FastifyInstance,
  prompt: string,
): Promise<{ ok: true; base64: string } | { ok: false; code: string; message: string }> {
  const credentials = await resolveImageCredentials(fastify.prisma)
  if (!credentials) {
    return {
      ok: false,
      code: "NO_IMAGE_MODEL",
      message: "Add a Grok model under Models first — its key is used to generate images.",
    }
  }

  try {
    const response = await fetch(`${credentials.baseUrl}${XAI_IMAGE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        n: 1,
        aspect_ratio: "16:9",
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      return {
        ok: false,
        code: "IMAGE_FAILED",
        message: `The image service returned HTTP ${response.status}.`,
      }
    }
    const data = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
    const first = data.data?.[0]
    if (first?.b64_json) return { ok: true, base64: first.b64_json }
    if (first?.url && isSafeImageUrl(first.url)) {
      const image = await fetch(first.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (image.ok) {
        return { ok: true, base64: Buffer.from(await image.arrayBuffer()).toString("base64") }
      }
    }
    return { ok: false, code: "IMAGE_FAILED", message: "The image service returned no image." }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    return {
      ok: false,
      code: "IMAGE_FAILED",
      message: timedOut ? "The image service did not respond in time." : "Could not reach the image service.",
    }
  }
}

export async function generateAssetCoverImage(
  fastify: FastifyInstance,
  assetId: string,
): Promise<CoverResult> {
  const asset = await fastify.prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    include: { storageObject: true, library: { include: { storageLocation: true } } },
  })
  if (!asset) return { ok: false, code: "NOT_FOUND", message: "That file no longer exists." }

  // Only documents. A cover is drawn from what the file says, and the assistant
  // cannot read a video or a photograph — it would be inventing a picture from
  // a filename and charging for it.
  if (asset.mediaType === "VIDEO" || asset.mediaType === "IMAGE") {
    return {
      ok: false,
      code: "UNSUPPORTED",
      message: "Covers are drawn from a document's text, so only documents can have one.",
    }
  }

  const credentials = await resolveImageCredentials(fastify.prisma)
  if (!credentials) {
    return {
      ok: false,
      code: "NO_IMAGE_MODEL",
      message: "Add a Grok model under Models first — its key is used to generate covers.",
    }
  }

  const isPdf =
    /\.pdf$/i.test(asset.originalFilename) ||
    (asset.mimeType ?? "").toLowerCase() === "application/pdf"

  let excerpt = ""
  if (isPdf) {
    const read = await readPdfAssetContent(fastify.prisma, { assetId, maxPages: 3 })
    if (typeof read.content === "string") {
      // Sanitised at the source, so both the brief path and the direct fallback
      // get text with the obvious steering removed.
      excerpt = sanitizeDocumentExcerpt(stripReaderPreamble(read.content))
    }
  }

  // A cheap text model reads the document and art-directs; the image model only
  // draws. If that step is unavailable the excerpt goes straight into the prompt
  // as before, which still works — it is just a worse brief.
  const brief = await writeCoverBrief(fastify, asset.originalFilename, excerpt)
  const prompt = brief
    ? buildCoverPromptFromBrief(brief)
    : buildCoverPrompt({ filename: asset.originalFilename, excerpt })

  let payload: { data?: Array<{ b64_json?: string; url?: string }> }
  try {
    const response = await fetch(`${credentials.baseUrl}${XAI_IMAGE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        n: 1,
        // Cards are portrait-ish, and asking for base64 avoids a second fetch
        // against a URL the docs describe as short-lived.
        aspect_ratio: "3:4",
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      fastify.log.warn({ status: response.status }, "Cover image request rejected")
      return {
        ok: false,
        code: "IMAGE_FAILED",
        message:
          response.status === 401
            ? "The Grok key was rejected. Check it under Models."
            : `The image service returned HTTP ${response.status}.`,
      }
    }
    payload = (await response.json()) as typeof payload
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    return {
      ok: false,
      code: "IMAGE_FAILED",
      message: timedOut ? "The image service did not respond in time." : "Could not reach the image service.",
    }
  }

  const first = payload.data?.[0]
  let bytes: Buffer | null = null
  if (first?.b64_json) {
    bytes = Buffer.from(first.b64_json, "base64")
  } else if (first?.url && isSafeImageUrl(first.url)) {
    // The docs return URLs by default and call them temporary, so it is fetched
    // immediately rather than stored as a reference.
    try {
      const image = await fetch(first.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (image.ok) bytes = Buffer.from(await image.arrayBuffer())
    } catch {
      /* handled below */
    }
  }

  if (!bytes?.length) {
    return { ok: false, code: "IMAGE_FAILED", message: "The image service returned no image." }
  }

  const sharp = (await import("sharp")).default
  const target = resolvedThumbnailPath(
    asset.library.storageLocation.rootPath,
    asset.id,
    asset.storageObject.physicalPath,
  )
  await mkdir(path.dirname(target), { recursive: true })
  // Written as webp at the same path and shape the page render uses, so the
  // existing thumbnail route serves it without knowing the difference.
  await writeFile(target, await sharp(bytes).resize(640, 853, { fit: "cover" }).webp({ quality: 82 }).toBuffer())

  // The card requests its thumbnail with ?v=<updatedAt>, so without this the
  // browser keeps serving the page render it already cached and the new cover
  // never appears. Touching the row changes the URL.
  await fastify.prisma.asset.update({
    where: { id: asset.id },
    // coverImageAt is what tells the card to ask the server for a thumbnail at
    // all: a PDF renders its own first page in the browser, so without this the
    // cover sits on disk and is never requested.
    data: { updatedAt: new Date(), coverImageAt: new Date() },
  })

  return { ok: true, prompt }
}
