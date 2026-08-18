import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Readable } from "node:stream"
import { once } from "node:events"

import { assertExternalDownloadUrlIsPublic, safeRequest } from "@/services/safe-fetch"

import { Queue } from "bullmq"
import { execa } from "execa"
import { fileTypeFromFile } from "file-type"
import type Redis from "ioredis"

import type { Prisma } from "@prisma/client"
import { prisma } from "@arciin/database"
import {
  DEFAULT_MEDIA_JOB_OPTIONS,
  JOB_QUEUE_NAMES,
  JOB_TYPES,
  assetSupportsDocumentThumbnail,
  inferMediaType,
  type ImportUrlPayload,
  apiOwnsCompletionEvent,
  initialUploadSessionState,
} from "@arciin/shared"
import { normalizeConfiguredStorageRoot } from "@arciin/storage"

import { workerConfig } from "@/config"
import { syncConnectorMirrorsForAsset } from "@/services/connector-mirror"
import { createRealtimeEvent, publishRealtimeEvent } from "@/services/realtime"

const MAX_IMPORT_BYTES =
  (Number(process.env.MAX_UPLOAD_SIZE_MB) > 0 ? Number(process.env.MAX_UPLOAD_SIZE_MB) : 20 * 1024) *
  1024 *
  1024

/** OpenGraph tags live in the <head>; cap the HTML read so a huge body can't OOM us. */
const MAX_HTML_BYTES = 5 * 1024 * 1024

/** Video/social platforms yt-dlp handles far better than a raw fetch. */
const VIDEO_PLATFORM_HINT =
  /(youtube\.com|youtu\.be|vimeo\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|dailymotion\.com|twitch\.tv|reddit\.com|streamable\.com)/i

/**
 * Streaming hosts that use DRM (or equivalent closed apps). yt-dlp will never
 * return a usable file — fail fast with a clear message instead of a generic
 * "could not find a downloadable file".
 */
const DRM_HOST_HINT =
  /(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com|netflix\.com|disneyplus\.com|hulu\.com|max\.com|hbomax\.com|primevideo\.com|amazon\.com\/gp\/video|music\.apple\.com|tv\.apple\.com|tidal\.com|deezer\.com|pandora\.com|crunchyroll\.com|peacocktv\.com|paramountplus\.com)/i

/** Instagram embed works with crawler UAs; the default Chrome UA often gets a login wall. */
const INSTAGRAM_EMBED_USER_AGENT = "facebookexternalhit/1.1"
const INSTAGRAM_EMBED_USER_AGENTS = [
  INSTAGRAM_EMBED_USER_AGENT,
  "Mozilla/5.0 (compatible; facebookexternalhit/1.1)",
  "Mozilla/5.0",
]

/** Instagram image posts and carousels need embed scraping; yt-dlp only handles reels/video. */
const INSTAGRAM_HINT = /instagram\.com|instagr\.am/i

let mediaQueue: Queue | null = null
function getMediaQueue(): Queue {
  if (mediaQueue) return mediaQueue
  const redisUrl = new URL(workerConfig.REDIS_URL)
  mediaQueue = new Queue(JOB_QUEUE_NAMES.media, {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0,
      tls: redisUrl.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null,
    },
    // Same retry budget and Redis retention as the API's producers.
    defaultJobOptions: DEFAULT_MEDIA_JOB_OPTIONS,
    prefix: workerConfig.queuePrefix,
  })
  return mediaQueue
}

function resolveBinary(name: string, envVar: string): string {
  const fromEnv = process.env[envVar]?.trim()
  if (fromEnv) return fromEnv
  const local = path.join(os.homedir(), ".local", "bin", name)
  if (existsSync(local)) return local
  return name
}

/** Optional yt-dlp cookie sources for sites that require login (e.g. private Facebook posts). */
function ytDlpCookieArgs(): string[] {
  const fromBrowser = process.env.ARCIIN_YTDLP_COOKIES_FROM_BROWSER?.trim()
  if (fromBrowser) return ["--cookies-from-browser", fromBrowser]
  const cookiesFile = process.env.ARCIIN_YTDLP_COOKIES?.trim()
  if (cookiesFile && existsSync(cookiesFile)) return ["--cookies", cookiesFile]
  return []
}

function isPublicHttpUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return false
  }
  return true
}

type ResolvedDownload = {
  filePath: string
  filename: string
  fallbackMime?: string
}

function filenameFromUrl(rawUrl: string, fallbackExt = "bin"): string {
  try {
    const url = new URL(rawUrl)
    const last = url.pathname.split("/").filter(Boolean).pop()
    if (last && /\.[a-z0-9]{1,8}$/i.test(last)) return decodeURIComponent(last)
    return `${url.hostname.replace(/[^\w.-]+/g, "-")}.${fallbackExt}`
  } catch {
    return `import.${fallbackExt}`
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const star = header.match(/filename\*=(?:UTF-8'')?["']?([^"';]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      return star[1]
    }
  }
  const plain = header.match(/filename=["']?([^"';]+)/i)
  return plain?.[1] ?? null
}

async function streamResponseToFile(stream: Readable, filePath: string): Promise<void> {
  const out = createWriteStream(filePath)
  let size = 0
  try {
    for await (const chunk of stream) {
      size += (chunk as Buffer).length
      if (size > MAX_IMPORT_BYTES) {
        stream.destroy()
        out.destroy()
        throw new Error("This file is larger than the import size limit.")
      }
      if (!out.write(chunk)) await once(out, "drain")
    }
    out.end()
    await once(out, "finish")
  } catch (err) {
    out.destroy()
    throw err
  }
}

/** Read a capped amount of text (for OG parsing) then abandon the rest of the stream. */
async function readTextCapped(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
    size += (chunk as Buffer).length
    if (size >= maxBytes) {
      stream.destroy() // enough to have captured <meta> in <head>
      break
    }
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** Fetch the URL once (SSRF-guarded): return a downloaded file, or HTML for OG parsing. */
async function fetchDirectOrHtml(
  rawUrl: string,
  workDir: string,
): Promise<
  | { kind: "file"; download: ResolvedDownload }
  | { kind: "html"; html: string; finalUrl: string }
> {
  // safeRequest validates the resolved IP at connect time and re-validates
  // every redirect hop — replaces `fetch(redirect: "follow")` which is SSRF-prone.
  const response = await safeRequest(rawUrl)
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.stream.resume()
    throw new Error(`The link responded with ${response.statusCode}.`)
  }

  const finalUrl = response.finalUrl || rawUrl
  const contentType = String(response.headers["content-type"] || "").toLowerCase()

  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    const html = await readTextCapped(response.stream, MAX_HTML_BYTES)
    return { kind: "html", html, finalUrl }
  }

  const dispositionHeader = response.headers["content-disposition"]
  const dispositionName = filenameFromContentDisposition(
    typeof dispositionHeader === "string" ? dispositionHeader : null,
  )
  const filename = dispositionName || filenameFromUrl(finalUrl)
  const filePath = path.join(workDir, `direct-${Date.now()}${path.extname(filename) || ""}`)
  await streamResponseToFile(response.stream, filePath)
  return {
    kind: "file",
    download: { filePath, filename, fallbackMime: contentType.split(";")[0] || undefined },
  }
}

async function firstFileIn(dir: string): Promise<string | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: { p: string; size: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      // yt-dlp writes `.part` / `.ytdl` while downloading — never import those.
      const lower = entry.name.toLowerCase()
      if (
        lower.endsWith(".part") ||
        lower.endsWith(".ytdl") ||
        lower.endsWith(".temp") ||
        lower.endsWith(".tmp") ||
        lower.startsWith(".")
      ) {
        continue
      }
      const full = path.join(dir, entry.name)
      const info = await stat(full)
      if (info.size <= 0) continue
      files.push({ p: full, size: info.size })
    }
    files.sort((a, b) => b.size - a.size)
    return files[0]?.p ?? null
  } catch {
    return null
  }
}

type YtDlpImportOptions = {
  audioOnly?: boolean
  audioFormat?: "mp3" | "m4a"
  videoFormat?: "mp4" | "best"
}

async function tryYtDlp(
  rawUrl: string,
  workDir: string,
  opts: YtDlpImportOptions = {},
): Promise<ResolvedDownload | null> {
  // yt-dlp opens its own sockets, so safeRequest's rebind-safe lookup never
  // sees this URL. Check it here or the video path becomes the way around the
  // guard the plain-HTTP path enforces.
  await assertExternalDownloadUrlIsPublic(rawUrl)

  const bin = resolveBinary("yt-dlp", "ARCIIN_YTDLP_BIN")
  const outDir = path.join(workDir, "ytdlp")
  await mkdir(outDir, { recursive: true })
  const maxFilesize = `${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))}m`
  const args = opts.audioOnly
    ? [
        // Extract audio only and transcode (needs ffmpeg, which the worker has).
        "-f",
        "ba/b",
        "-x",
        "--audio-format",
        opts.audioFormat ?? "mp3",
        "--audio-quality",
        "0",
      ]
    : opts.videoFormat === "best"
      ? ["-f", "bv*+ba/best"]
      : [
          "-f",
          // Prefer H.264 (avc1) video + AAC (mp4a) audio so imported videos play
          // everywhere — iOS Safari cannot decode VP9/AV1 (YouTube/social default
          // to those for "best video"). Fall back progressively, and only to the
          // absolute best if the source offers no H.264 at all.
          "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
          "--merge-output-format",
          opts.videoFormat ?? "mp4",
        ]
  try {
    await execa(
      bin,
      [
        ...args,
        ...ytDlpCookieArgs(),
        // Android/web clients avoid many YouTube HTTP 403s from datacenter IPs.
        "--extractor-args",
        "youtube:player_client=android,web",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--no-continue",
        "--force-ipv4",
        "--restrict-filenames",
        "--max-filesize",
        maxFilesize,
        "-o",
        path.join(outDir, "%(id)s.%(ext)s"),
        rawUrl,
      ],
      { timeout: 8 * 60 * 1000, reject: true },
    )
  } catch (err) {
    // yt-dlp may exit non-zero after a successful merge when separate video+audio
    // streams were downloaded (--max-downloads counted each stream). Prefer the file on disk.
    const producedAfterError = await firstFileIn(outDir)
    if (producedAfterError) {
      return { filePath: producedAfterError, filename: path.basename(producedAfterError) }
    }

    const stderr =
      err instanceof Error && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr.trim()
        : ""
    const message =
      stderr.split("\n").filter(Boolean).pop() ??
      (err instanceof Error ? err.message : null)
    if (message) {
      console.warn(`[url-import] yt-dlp failed for ${rawUrl}: ${message}`)
    }
    if (stderr.toLowerCase().includes("ffmpeg")) {
      throw new Error(
        "Video merge requires ffmpeg on the server. Install ffmpeg and restart the Arciin worker.",
      )
    }
    return null
  }
  const produced = await firstFileIn(outDir)
  if (!produced) return null
  return { filePath: produced, filename: path.basename(produced) }
}

async function tryGalleryDl(rawUrl: string, workDir: string): Promise<ResolvedDownload | null> {
  // Same reasoning as tryYtDlp — gallery-dl fetches on its own.
  await assertExternalDownloadUrlIsPublic(rawUrl)

  const bin = resolveBinary("gallery-dl", "ARCIIN_GALLERYDL_BIN")
  const outDir = path.join(workDir, "gallerydl")
  await mkdir(outDir, { recursive: true })
  try {
    await execa(
      bin,
      ["--dest", outDir, "--range", "1-1", "--no-mtime", "-q", rawUrl],
      { timeout: 4 * 60 * 1000, reject: true },
    )
  } catch {
    return null
  }
  // gallery-dl nests files under site/user subdirs — walk for the first real file.
  const found = await findFileRecursive(outDir)
  if (!found) return null
  return { filePath: found, filename: path.basename(found) }
}

async function findFileRecursive(dir: string, depth = 0): Promise<string | null> {
  if (depth > 6) return null
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && !entry.name.startsWith(".")) return full
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await findFileRecursive(path.join(dir, entry.name), depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function extractMetaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ]
  for (const re of patterns) {
    const match = html.match(re)
    if (match?.[1]) return decodeHtmlEntities(match[1])
  }
  return null
}

async function downloadMediaUrl(
  mediaUrl: string,
  workDir: string,
  opts: { referer?: string; filename?: string; userAgent?: string } = {},
): Promise<ResolvedDownload> {
  const response = await safeRequest(mediaUrl, {
    referer: opts.referer,
    userAgent: opts.userAgent,
  })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.stream.resume()
    throw new Error(`The link responded with ${response.statusCode}.`)
  }

  const contentType = String(response.headers["content-type"] || "").toLowerCase()
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    response.stream.resume()
    throw new Error("The link returned a web page instead of a file.")
  }

  const dispositionHeader = response.headers["content-disposition"]
  const dispositionName = filenameFromContentDisposition(
    typeof dispositionHeader === "string" ? dispositionHeader : null,
  )
  const filename = opts.filename || dispositionName || filenameFromUrl(mediaUrl, "jpg")
  const filePath = path.join(workDir, `media-${Date.now()}${path.extname(filename) || ""}`)
  await streamResponseToFile(response.stream, filePath)
  return {
    filePath,
    filename,
    fallbackMime: contentType.split(";")[0] || undefined,
  }
}

function instagramPostUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const match = url.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
    if (!match?.[1]) return null
    return `https://www.instagram.com/p/${match[1]}/`
  } catch {
    return null
  }
}

function instagramImageIndex(rawUrl: string): number {
  try {
    const value = Number(new URL(rawUrl).searchParams.get("img_index"))
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1
  } catch {
    return 1
  }
}

function instagramEmbedLooksLikeLoginWall(html: string): boolean {
  return !html.includes("scontent") && /login|Log in to Instagram/i.test(html)
}

function instagramImageQualityScore(url: string): number {
  let score = 0
  if (/dst-jpg_e35/i.test(url) && !/_p\d+x\d+/i.test(url)) score += 100
  if (/s1080x1080/i.test(url)) score += 90
  if (/s750x750/i.test(url)) score += 70
  if (/e35/i.test(url)) score += 50
  if (/CAROUSEL_ITEM|xpids/i.test(url)) score += 30
  if (/_p\d+x\d+/i.test(url)) score -= 20
  return score
}

function extractInstagramEmbedImages(html: string): string[] {
  const decoded = decodeHtmlEntities(html)
    .replace(/\\u0026/g, "&")
    .replace(/\\u00253D/g, "=")
    .replace(/\\u00252F/g, "/")

  const urlPattern =
    /https:\/\/scontent[^"'\s<>\\]+\.cdninstagram\.com\/[^"'\s<>\\]+\.(?:jpg|jpeg|webp)(?:\?[^"'\s<>\\]*)?/gi

  const seen = new Set<string>()
  const candidates: { url: string; index: number }[] = []

  for (const match of decoded.matchAll(urlPattern)) {
    const clean = match[0].replace(/\s+\d+w.*$/i, "")
    if (seen.has(clean)) continue
    seen.add(clean)

    if (/profile_pic|_s100x100|_s150x150|dst-jpg_s\d+x\d+/i.test(clean)) continue

    candidates.push({ url: clean, index: candidates.length })
  }

  const byKey = new Map<string, { url: string; score: number; index: number }>()
  for (const candidate of candidates) {
    const keyMatch = candidate.url.match(/ig_cache_key=([^&]+)/)
    const key = keyMatch?.[1] ?? candidate.url
    const score = instagramImageQualityScore(candidate.url)
    const existing = byKey.get(key)
    if (!existing || score > existing.score) {
      byKey.set(key, { url: candidate.url, score, index: candidate.index })
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.url)
}

async function tryInstagramEmbed(
  rawUrl: string,
  workDir: string,
): Promise<ResolvedDownload | null> {
  const postUrl = instagramPostUrl(rawUrl)
  if (!postUrl) return null

  const embedUrl = `${postUrl}embed/captioned/`
  const imageIndex = instagramImageIndex(rawUrl)
  let html: string | null = null

  for (const userAgent of INSTAGRAM_EMBED_USER_AGENTS) {
    try {
      const response = await safeRequest(embedUrl, {
        timeoutMs: 30_000,
        referer: postUrl,
        userAgent,
      })
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.stream.resume()
        continue
      }
      const body = await readTextCapped(response.stream, MAX_HTML_BYTES)
      if (instagramEmbedLooksLikeLoginWall(body)) continue
      html = body
      break
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[url-import] Instagram embed fetch failed for ${rawUrl}: ${message}`)
    }
  }

  if (!html) return null

  const images = extractInstagramEmbedImages(html)
  if (!images.length) return null

  const mediaUrl = images[Math.min(imageIndex, images.length) - 1]!
  if (!isPublicHttpUrl(mediaUrl)) return null

  const shortcode = postUrl.match(/\/p\/([^/]+)\//)?.[1] ?? "post"
  try {
    return await downloadMediaUrl(mediaUrl, workDir, {
      referer: postUrl,
      userAgent: INSTAGRAM_EMBED_USER_AGENT,
      filename: `instagram-${shortcode}.jpg`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[url-import] Instagram image download failed for ${rawUrl}: ${message}`)
    return null
  }
}

async function resolveInstagramDownload(
  rawUrl: string,
  workDir: string,
  opts: YtDlpImportOptions = {},
): Promise<ResolvedDownload> {
  if (opts.audioOnly) {
    const viaYtAudio = await tryYtDlp(rawUrl, workDir, {
      audioOnly: true,
      audioFormat: opts.audioFormat,
    })
    if (viaYtAudio) return viaYtAudio
  }

  const viaYtVideo = await tryYtDlp(rawUrl, workDir, opts)
  if (viaYtVideo) return viaYtVideo

  const viaEmbed = await tryInstagramEmbed(rawUrl, workDir)
  if (viaEmbed) return viaEmbed

  const viaGallery = await tryGalleryDl(rawUrl, workDir)
  if (viaGallery) return viaGallery

  const initial = await fetchDirectOrHtml(rawUrl, workDir)
  if (initial.kind === "file") return initial.download

  const viaOg = await tryOpenGraphMedia(initial.html, initial.finalUrl, workDir)
  if (viaOg) return viaOg

  throw new Error("Could not find a downloadable file at that Instagram link.")
}

async function tryOpenGraphMedia(
  html: string,
  finalUrl: string,
  workDir: string,
  mode: "video" | "image" | "any" = "any",
): Promise<ResolvedDownload | null> {
  const videoCandidate =
    extractMetaContent(html, "og:video:secure_url") ||
    extractMetaContent(html, "og:video:url") ||
    extractMetaContent(html, "og:video")
  const imageCandidate =
    extractMetaContent(html, "og:image:secure_url") ||
    extractMetaContent(html, "og:image") ||
    extractMetaContent(html, "twitter:image")

  const candidates =
    mode === "video"
      ? [videoCandidate]
      : mode === "image"
        ? [imageCandidate]
        : [videoCandidate, imageCandidate]

  for (const candidate of candidates) {
    if (!candidate) continue
    let mediaUrl: string
    try {
      mediaUrl = new URL(candidate, finalUrl).toString()
    } catch {
      continue
    }
    if (!isPublicHttpUrl(mediaUrl)) continue

    // OG video may be an embed page (YouTube watch URL) — hand it to yt-dlp.
    if (VIDEO_PLATFORM_HINT.test(mediaUrl) || /\.(m3u8|mpd)(\?|$)/i.test(mediaUrl)) {
      const viaYt = await tryYtDlp(mediaUrl, workDir)
      if (viaYt) return viaYt
      continue
    }

    const result = await fetchDirectOrHtml(mediaUrl, workDir)
    if (result.kind === "file") return result.download
  }
  return null
}

function htmlLooksLikeVideoPage(html: string, finalUrl: string): boolean {
  const ogType = (extractMetaContent(html, "og:type") || "").toLowerCase()
  if (ogType.startsWith("video")) return true
  return /\/(movie|watch|episode|film|video|stream)\b/i.test(finalUrl)
}

/**
 * Pull playable embeds out of an HTML page: JSON-LD VideoObject.embedUrl,
 * iframe players (YouTube/Vimeo/…), and direct .m3u8/.mp4 hrefs.
 * Movie aggregator pages (123movies clones, etc.) often only expose a trailer
 * or third-party player this way — better than failing with nothing.
 */
function extractEmbeddedPlayerUrls(html: string, baseUrl: string): string[] {
  const found: string[] = []
  const push = (raw: string | undefined | null) => {
    if (!raw) return
    let absolute: string
    try {
      absolute = new URL(decodeHtmlEntities(raw.trim()), baseUrl).toString()
    } catch {
      return
    }
    if (!isPublicHttpUrl(absolute)) return
    if (found.includes(absolute)) return
    found.push(absolute)
  }

  // JSON-LD blocks — VideoObject.embedUrl / contentUrl
  // Some hosts omit quotes: type=application/ld+json
  for (const block of html.matchAll(
    /<script[^>]+type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = block[1]?.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        walkJsonLdForMedia(node, push)
      }
    } catch {
      // Some pages concatenate multiple JSON objects — ignore bad blocks.
    }
  }

  // iframe / embed players
  for (const match of html.matchAll(
    /<(?:iframe|embed)[^>]+src=["']([^"']+)["']/gi,
  )) {
    push(match[1])
  }

  // Direct stream / file links in the markup
  for (const match of html.matchAll(
    /https?:\/\/[^"'<\s]+?\.(?:m3u8|mpd|mp4|webm|mkv)(?:\?[^"'<\s]*)?/gi,
  )) {
    push(match[0])
  }

  // Prefer known extractors first, then streams, then anything else.
  return found.sort((a, b) => {
    const score = (u: string) => {
      if (VIDEO_PLATFORM_HINT.test(u)) return 0
      if (/\.(m3u8|mpd)(\?|$)/i.test(u)) return 1
      if (/\.(mp4|webm|mkv)(\?|$)/i.test(u)) return 2
      return 3
    }
    return score(a) - score(b)
  })
}

function walkJsonLdForMedia(
  node: unknown,
  push: (url: string | null | undefined) => void,
  depth = 0,
) {
  if (!node || depth > 8) return
  if (Array.isArray(node)) {
    for (const child of node) walkJsonLdForMedia(child, push, depth + 1)
    return
  }
  if (typeof node !== "object") return
  const obj = node as Record<string, unknown>
  push(typeof obj.embedUrl === "string" ? obj.embedUrl : null)
  push(typeof obj.contentUrl === "string" ? obj.contentUrl : null)
  if (typeof obj.url === "string" && VIDEO_PLATFORM_HINT.test(obj.url)) {
    push(obj.url)
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      walkJsonLdForMedia(value, push, depth + 1)
    }
  }
}

async function tryEmbeddedPlayers(
  html: string,
  finalUrl: string,
  workDir: string,
  opts: YtDlpImportOptions,
): Promise<ResolvedDownload | null> {
  const embeds = extractEmbeddedPlayerUrls(html, finalUrl).slice(0, 6)
  for (const embed of embeds) {
    // Skip self-referential page URLs.
    try {
      if (new URL(embed).pathname === new URL(finalUrl).pathname) continue
    } catch {
      continue
    }

    if (VIDEO_PLATFORM_HINT.test(embed) || /\.(m3u8|mpd)(\?|$)/i.test(embed)) {
      const viaYt = await tryYtDlp(embed, workDir, opts)
      if (viaYt) {
        console.info(`[url-import] downloaded embedded player ${embed} for ${finalUrl}`)
        return viaYt
      }
    }

    if (/\.(mp4|webm|mkv)(\?|$)/i.test(embed)) {
      try {
        return await downloadMediaUrl(embed, workDir, { referer: finalUrl })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[url-import] direct embed download failed for ${embed}: ${message}`)
      }
    }
  }
  return null
}

function drmBlockedMessage(rawUrl: string): string | null {
  let host = ""
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!DRM_HOST_HINT.test(host) && !DRM_HOST_HINT.test(rawUrl)) return null

  if (/spotify/i.test(host) || /spotify/i.test(rawUrl)) {
    return (
      "Spotify is DRM-protected and cannot be downloaded. " +
      "Use a YouTube / SoundCloud link, a direct .mp3 URL, or an open podcast RSS episode file instead."
    )
  }
  if (/netflix|disney|hulu|hbo|max\.com|primevideo|peacock|paramount|crunchyroll/i.test(host)) {
    return (
      "This streaming service uses DRM and cannot be imported. " +
      "Paste a YouTube link or a direct video file URL instead."
    )
  }
  if (/apple\.com|tidal|deezer|pandora/i.test(host)) {
    return (
      "This music service is DRM-protected and cannot be downloaded. " +
      "Paste a direct audio file URL or a YouTube / SoundCloud link instead."
    )
  }
  return (
    "This site uses DRM protection, so Arciin cannot download the media. " +
    "Try a YouTube link or a direct file URL."
  )
}

/** Resolve any link to a concrete file on disk. Throws with a friendly message on failure. */
async function resolveDownload(
  rawUrl: string,
  workDir: string,
  opts: YtDlpImportOptions = {},
): Promise<ResolvedDownload> {
  const drmMessage = drmBlockedMessage(rawUrl)
  if (drmMessage) {
    throw new Error(drmMessage)
  }

  if (INSTAGRAM_HINT.test(rawUrl)) {
    return resolveInstagramDownload(rawUrl, workDir, opts)
  }

  const preferVideoTool = VIDEO_PLATFORM_HINT.test(rawUrl)

  // Audio-only requests always try yt-dlp first so we can extract just the audio,
  // regardless of whether the host is a known video platform.
  if (opts.audioOnly) {
    const viaYtAudio = await tryYtDlp(rawUrl, workDir, {
      audioOnly: true,
      audioFormat: opts.audioFormat,
    })
    if (viaYtAudio) return viaYtAudio
  }

  // Known video platforms: go straight to yt-dlp (a plain fetch returns an HTML shell).
  if (preferVideoTool) {
    const viaYt = await tryYtDlp(rawUrl, workDir, opts)
    if (viaYt) return viaYt
  }

  const initial = await fetchDirectOrHtml(rawUrl, workDir)
  if (initial.kind === "file") return initial.download

  if (!preferVideoTool) {
    const viaYt = await tryYtDlp(rawUrl, workDir, opts)
    if (viaYt) return viaYt
  }

  const viaGallery = await tryGalleryDl(rawUrl, workDir)
  if (viaGallery) return viaGallery

  // Movie / show aggregator pages: follow embedded YouTube/Vimeo/m3u8 players.
  const viaEmbed = await tryEmbeddedPlayers(initial.html, initial.finalUrl, workDir, opts)
  if (viaEmbed) return viaEmbed

  const viaOgVideo = await tryOpenGraphMedia(initial.html, initial.finalUrl, workDir, "video")
  if (viaOgVideo) return viaOgVideo

  const videoPage = htmlLooksLikeVideoPage(initial.html, initial.finalUrl)
  // Do not silently save a poster JPG for movie pages — that looks like a successful
  // download of the film when it is only the cover art.
  if (!videoPage) {
    const viaOgImage = await tryOpenGraphMedia(initial.html, initial.finalUrl, workDir, "image")
    if (viaOgImage) return viaOgImage
  }

  if (videoPage) {
    throw new Error(
      "This looks like a streaming / movie page, but Arciin could not reach a playable video file " +
        "(player blocked, DRM, or unsupported host). Paste a YouTube link or a direct .mp4 / .m3u8 URL instead.",
    )
  }

  throw new Error(
    "Could not find a downloadable file at that link. " +
      "Arciin works best with YouTube, TikTok, Instagram, SoundCloud, direct .mp4/.mp3/.pdf URLs, " +
      "or pages that embed a public player. DRM streaming apps (Spotify, Netflix, etc.) are not supported.",
  )
}

async function hashFile(filePath: string): Promise<{ checksum: string; size: number }> {
  const hash = createHash("sha256")
  let size = 0
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
    size += (chunk as Buffer).length
  }
  return { checksum: hash.digest("hex"), size }
}

function libraryKindForMediaType(
  mediaType: string,
): "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT" | "INBOX" {
  switch (mediaType) {
    case "VIDEO":
      return "VIDEO"
    case "IMAGE":
      return "IMAGE"
    case "AUDIO":
      return "AUDIO"
    case "DOCUMENT":
      return "DOCUMENT"
    default:
      return "INBOX"
  }
}

function objectStoragePath(storageRoot: string, checksum: string, extension: string) {
  const normalizedExtension = extension.startsWith(".")
    ? extension.toLowerCase()
    : extension
      ? `.${extension.toLowerCase()}`
      : ""
  const objectKey = path.join(
    "objects",
    checksum.slice(0, 2),
    checksum.slice(2, 4),
    `${checksum}${normalizedExtension}`,
  )
  return { objectKey, physicalPath: path.join(storageRoot, objectKey) }
}

async function enqueueMediaJob(
  type: string,
  payload: { assetId: string; uploadId: string; userId: string },
) {
  const job = await prisma.job.create({
    data: { type, status: "QUEUED", progress: 0, payload },
  })
  await getMediaQueue().add(type, { ...payload, jobRecordId: job.id })
}

async function recordActivityEvent(input: {
  userId: string
  type: string
  title: string
  message?: string
  entityId?: string
  metadata?: Record<string, unknown>
  redis: Redis
}) {
  const row = await prisma.activityEvent.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityId ? "asset" : undefined,
      entityId: input.entityId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
  await publishRealtimeEvent(
    input.redis,
    createRealtimeEvent("activity.created", {
      userId: input.userId,
      message: input.message,
      data: {
        type: input.type,
        title: input.title,
        activityId: row.id,
        entityType: input.entityId ? "asset" : undefined,
        entityId: input.entityId,
        ...(input.metadata ?? {}),
      },
    }),
  )
}

async function markSessionFailed(uploadId: string, message: string) {
  await prisma.uploadSession
    .update({
      where: { id: uploadId },
      data: { status: "FAILED", error: message.slice(0, 500), progress: 0 },
    })
    .catch(() => {})
}

async function updateImportJobRecord(
  jobRecordId: string | undefined,
  input: {
    status: "ACTIVE" | "COMPLETED" | "FAILED"
    progress: number
    error?: string
  },
) {
  if (!jobRecordId) return
  await prisma.job
    .update({
      where: { id: jobRecordId },
      data: {
        status: input.status,
        progress: input.progress,
        error: input.error,
        completedAt:
          input.status === "COMPLETED" || input.status === "FAILED" ? new Date() : null,
      },
    })
    .catch(() => {})
}

async function publishImportProgress(
  redis: Redis,
  input: {
    userId: string
    uploadId: string
    progress: number
    message?: string
    destination?: string
  },
) {
  await prisma.uploadSession
    .update({
      where: { id: input.uploadId },
      data: { progress: input.progress, status: "UPLOADING" },
    })
    .catch(() => {})

  await publishRealtimeEvent(
    redis,
    createRealtimeEvent("upload.progress", {
      userId: input.userId,
      uploadId: input.uploadId,
      progress: input.progress,
      message: input.message,
      data: {
        origin: "url",
        source: "url",
        ...(input.destination ? { destination: input.destination } : {}),
      },
    }),
  ).catch(() => {})
}

export async function handleImportUrl(
  data: ImportUrlPayload & { jobRecordId?: string },
  redis: Redis,
): Promise<void> {
  const { url, uploadId, userId, targetLibraryId, targetFolderId, audioOnly, audioFormat, videoFormat } =
    data

  const existing = await prisma.uploadSession.findUnique({
    where: { id: uploadId },
    select: { status: true },
  })
  if (existing?.status === "FAILED") {
    return
  }

  if (!isPublicHttpUrl(url)) {
    await markSessionFailed(uploadId, "Only public http(s) links can be imported.")
    throw new Error("Blocked non-public import URL.")
  }

  await prisma.uploadSession
    .update({ where: { id: uploadId }, data: { status: "UPLOADING", progress: 15 } })
    .catch(() => {})

  await updateImportJobRecord(data.jobRecordId, { status: "ACTIVE", progress: 10 })
  await publishImportProgress(redis, {
    userId,
    uploadId,
    progress: 12,
    message: "Connecting to the link…",
  })

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = normalizeConfiguredStorageRoot(
    instance?.storageRoot,
    path.resolve(workerConfig.ARCIIN_DATA_DIR),
  )
  const workDir = path.join(storageRoot, "temp", `import-${uploadId}`)
  await mkdir(workDir, { recursive: true })

  try {
    await publishImportProgress(redis, {
      userId,
      uploadId,
      progress: 28,
      message: "Downloading from the link…",
    })

    const download = await resolveDownload(url, workDir, { audioOnly, audioFormat, videoFormat })

    await publishImportProgress(redis, {
      userId,
      uploadId,
      progress: 62,
      message: "Saving the file on your server…",
    })

    const { checksum, size } = await hashFile(download.filePath)
    if (size <= 0) throw new Error("The downloaded file was empty.")
    if (size > MAX_IMPORT_BYTES) throw new Error("This file is larger than the import size limit.")

    const detected = await fileTypeFromFile(download.filePath).catch(() => undefined)
    const mimeType = detected?.mime || download.fallbackMime || "application/octet-stream"
    const extension = (
      detected?.ext ||
      path.extname(download.filename).replace(".", "") ||
      "bin"
    ).toLowerCase()
    const mediaType = inferMediaType(mimeType, download.filename)

    const targetLibrary = targetLibraryId
      ? await prisma.library.findUnique({ where: { id: targetLibraryId } })
      : (await prisma.library.findFirst({ where: { kind: libraryKindForMediaType(mediaType) } })) ??
        (await prisma.library.findFirst({ where: { kind: "INBOX" } }))

    if (!targetLibrary) {
      throw new Error("No destination library is configured for imports.")
    }

    await publishImportProgress(redis, {
      userId,
      uploadId,
      progress: 65,
      message: `Saving to ${targetLibrary.name}…`,
      destination: targetLibrary.name,
    })

    let storageObject = await prisma.storageObject.findFirst({
      where: { checksumSha256: checksum, storageLocationId: targetLibrary.storageLocationId },
    })

    if (!storageObject) {
      const objectPath = objectStoragePath(storageRoot, checksum, extension)
      await mkdir(path.dirname(objectPath.physicalPath), { recursive: true })
      if (!existsSync(objectPath.physicalPath)) {
        await rename(download.filePath, objectPath.physicalPath)
      }
      storageObject = await prisma.storageObject.create({
        data: {
          storageLocationId: targetLibrary.storageLocationId,
          objectKey: objectPath.objectKey,
          physicalPath: objectPath.physicalPath,
          sizeBytes: BigInt(size),
          checksumSha256: checksum,
          mimeType,
        },
      })
    }

    const requiresProcessing =
      mediaType === "VIDEO" || mediaType === "IMAGE" || mediaType === "AUDIO"

    const asset = await prisma.asset.create({
      data: {
        libraryId: targetLibrary.id,
        folderId: targetFolderId ?? null,
        storageObjectId: storageObject.id,
        ownerId: userId,
        filename: `${checksum}.${extension}`,
        originalFilename: download.filename,
        mimeType,
        mediaType,
        extension,
        sizeBytes: BigInt(size),
        checksumSha256: checksum,
        importSourceUrl: url,
        status: requiresProcessing ? "PROCESSING" : "READY",
      },
    })

    await prisma.uploadSession.update({
      where: { id: uploadId },
      data: {
        originalFilename: download.filename,
        mimeType,
        sizeBytes: BigInt(size),
        detectedMediaType: mediaType,
        targetLibraryId: targetLibrary.id,
        assetId: asset.id,
        // Same rule as a direct upload: `completedAt` marks the end of worker
        // processing, so it stays null while media jobs are still queued.
        ...initialUploadSessionState(mediaType),
      },
    })

    await publishImportProgress(redis, {
      userId,
      uploadId,
      progress: requiresProcessing ? 88 : 96,
      message: requiresProcessing
        ? "Download complete — processing media…"
        : "Finishing up…",
      destination: targetLibrary.name,
    })

    await updateImportJobRecord(data.jobRecordId, { status: "COMPLETED", progress: 100 })

    if (requiresProcessing) {
      await enqueueMediaJob(JOB_TYPES.extractMetadata, { assetId: asset.id, uploadId, userId })
      if (mediaType === "VIDEO" || mediaType === "IMAGE") {
        await enqueueMediaJob(JOB_TYPES.generateThumbnail, { assetId: asset.id, uploadId, userId })
      }
    } else if (
      assetSupportsDocumentThumbnail(mediaType, mimeType, extension, download.filename)
    ) {
      await enqueueMediaJob(JOB_TYPES.generateThumbnail, { assetId: asset.id, uploadId, userId })
    } else {
      await syncConnectorMirrorsForAsset(asset.id).catch(() => {})
    }

    await recordActivityEvent({
      userId,
      type: "upload.completed",
      title: "Link imported",
      message: `${download.filename} imported to ${targetLibrary.name}.`,
      entityId: asset.id,
      metadata: {
        mediaType,
        libraryId: targetLibrary.id,
        destination: targetLibrary.name,
        source: "url",
        // The completion toast belongs to whoever finishes the work.
        pendingProcessing: requiresProcessing,
      },
      redis,
    })

    await publishRealtimeEvent(
      redis,
      createRealtimeEvent("asset.created", {
        userId,
        libraryId: targetLibrary.id,
        assetId: asset.id,
        message: `${download.filename} added to ${targetLibrary.name}.`,
        data: { mediaType, destination: targetLibrary.name, source: "url" },
      }),
    )

    // Exactly one upload.completed per import: when media jobs are still queued
    // the worker's own completion emits it, so this one is skipped.
    if (apiOwnsCompletionEvent(mediaType)) {
      await publishRealtimeEvent(
        redis,
        createRealtimeEvent("upload.completed", {
          userId,
          libraryId: targetLibrary.id,
          uploadId,
          assetId: asset.id,
          progress: 100,
          message: `${download.filename} imported successfully.`,
          data: {
            fileName: download.filename,
            sizeBytes: size,
            destination: targetLibrary.name,
            origin: "url",
          },
        }),
      )
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "The link could not be imported."
    const session = await prisma.uploadSession
      .findUnique({ where: { id: uploadId }, select: { originalFilename: true } })
      .catch(() => null)
    await markSessionFailed(uploadId, message)
    await updateImportJobRecord(data.jobRecordId, {
      status: "FAILED",
      progress: 0,
      error: message,
    })
    await recordActivityEvent({
      userId,
      type: "upload.failed",
      title: "Import failed",
      message,
      metadata: { source: "url", url },
      redis,
    }).catch(() => {})
    await publishRealtimeEvent(
      redis,
      createRealtimeEvent("upload.failed", {
        userId,
        uploadId,
        message,
        data: {
          source: "url",
          origin: "url",
          url,
          fileName: session?.originalFilename,
        },
      }),
    ).catch(() => {})
    throw error
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    // Release this user's in-flight import slot (paired with the API-side gate).
    const activeKey = `import:active:${userId}`
    const remaining = await redis.decr(activeKey).catch(() => 0)
    if (remaining < 0) await redis.set(activeKey, "0").catch(() => {})
  }
}
