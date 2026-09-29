import type { Readable } from "node:stream"

import { IMPORT_BATCH_MAX_ITEMS, type ImportCandidateCategory } from "@arciin/shared"

import {
  DRM_HOST_HINT,
  VIDEO_PLATFORM_HINT,
  decodeHtmlEntities,
  extractEmbeddedPlayerUrls,
  extractMetaContent,
  htmlLooksLikeVideoPage,
  isPublicHttpUrl,
} from "./link-extraction"

/**
 * The pure half of link inspection: turning a page's HTML, or yt-dlp's JSON
 * for a link, into at most five media candidates. No network — url-inspect.ts
 * does the fetching, under the same SSRF rules as an import.
 */

export type InspectedItem = {
  url: string
  title: string | null
  thumbnail: string | null
  durationSeconds: number | null
  source: string
  category: ImportCandidateCategory
}

export type InspectOutcome = {
  kind: "single" | "collection" | "none" | "blocked"
  title: string | null
  items: InspectedItem[]
  reason: string | null
}

/** Hosts where yt-dlp reads the link better than a plain fetch (adds audio platforms to the import list). */
export const YTDLP_FIRST_HINT = new RegExp(
  `${VIDEO_PLATFORM_HINT.source}|soundcloud\\.com|bandcamp\\.com|mixcloud\\.com`,
  "i",
)

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|m3u8|mpd)(\?|$)/i
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus)(\?|$)/i
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|rtf|epub)(\?|$)/i

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "")
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null
  const v = url.searchParams.get("v")
  if (v) return v
  const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/.exec(url.pathname)
  return m?.[1] ?? null
}

function vimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "")
  if (host === "player.vimeo.com") return /^\/video\/(\d+)/.exec(url.pathname)?.[1] ?? null
  if (host === "vimeo.com") return /^\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? null
  return null
}

/** Equivalent links map to one key: an embed and a watch link of the same video are one item. */
export function canonicalMediaKey(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  const yt = youtubeId(url)
  if (yt) return `youtube:${yt}`
  const vm = vimeoId(url)
  if (vm) return `vimeo:${vm}`
  url.hash = ""
  const path = url.pathname.replace(/\/+$/, "") || "/"
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${path}${url.search}`
}

/** The link to import: an embed player becomes the page yt-dlp knows how to read. */
export function importableMediaUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const yt = youtubeId(url)
    if (yt) return `https://www.youtube.com/watch?v=${encodeURIComponent(yt)}`
    const vm = vimeoId(url)
    if (vm) return `https://vimeo.com/${vm}`
  } catch {
    // fall through
  }
  return raw
}

const SOURCE_NAMES: Array<[RegExp, string]> = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
  [/(^|\.)vimeo\.com$/, "Vimeo"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)soundcloud\.com$/, "SoundCloud"],
  [/(^|\.)dailymotion\.com$/, "Dailymotion"],
  [/(^|\.)twitch\.tv$/, "Twitch"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
  [/(^|\.)(facebook\.com|fb\.watch)$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)bandcamp\.com$/, "Bandcamp"],
]

export function sourceName(raw: string): string {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    for (const [re, name] of SOURCE_NAMES) if (re.test(host)) return name
    return host.replace(/^www\./, "")
  } catch {
    return "Link"
  }
}

export function categoryForUrl(raw: string, contentType?: string | null): ImportCandidateCategory {
  const type = (contentType ?? "").toLowerCase()
  if (type.startsWith("video/") || type.includes("mpegurl") || type.includes("dash+xml")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("image/")) return "image"
  if (type.includes("pdf") || type.includes("officedocument") || type.includes("msword") || type.startsWith("text/plain")) {
    return "document"
  }
  if (/soundcloud\.com|bandcamp\.com|mixcloud\.com/i.test(raw)) return "audio"
  if (VIDEO_PLATFORM_HINT.test(raw) || VIDEO_EXT.test(raw)) return "video"
  if (AUDIO_EXT.test(raw)) return "audio"
  if (IMAGE_EXT.test(raw)) return "image"
  if (DOC_EXT.test(raw)) return "document"
  return "file"
}

/** ISO 8601 durations as JSON-LD writes them: PT1H2M3S → 3723. */
export function isoDurationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value !== "string") return null
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value.trim())
  if (!m) return null
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0))
  const total = d! * 86400 + h! * 3600 + min! * 60 + s!
  return total > 0 ? Math.round(total) : null
}

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null
  const text = decodeHtmlEntities(value).replace(/\s+/g, " ").trim()
  return text ? text.slice(0, max) : null
}

function absolutePublic(raw: unknown, base: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const url = new URL(decodeHtmlEntities(raw.trim()), base).toString()
    return isPublicHttpUrl(url) ? url : null
  } catch {
    return null
  }
}

type Meta = { title: string | null; thumbnail: string | null; durationSeconds: number | null }

/** JSON-LD VideoObjects carry a name, thumbnail and duration for the URL they describe. */
function jsonLdVideoMeta(html: string, base: string): Map<string, Meta> {
  const out = new Map<string, Meta>()
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 8) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    if (typeof node !== "object") return
    const obj = node as Record<string, unknown>
    const type = String(obj["@type"] ?? "")
    if (/VideoObject|AudioObject|MusicRecording/i.test(type)) {
      const thumb = Array.isArray(obj.thumbnailUrl) ? obj.thumbnailUrl[0] : obj.thumbnailUrl
      const meta: Meta = {
        title: cleanText(obj.name),
        thumbnail: absolutePublic(thumb, base),
        durationSeconds: isoDurationSeconds(obj.duration),
      }
      for (const key of ["contentUrl", "embedUrl", "url"]) {
        const url = absolutePublic(obj[key], base)
        if (url) out.set(canonicalMediaKey(url), meta)
      }
    }
    for (const value of Object.values(obj)) if (value && typeof value === "object") visit(value, depth + 1)
  }
  for (const block of html.matchAll(
    /<script[^>]+type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(block[1]!.trim()), 0)
    } catch {
      // malformed block: skip it, keep the rest
    }
  }
  return out
}

type Found = { url: string; thumbnail: string | null; title: string | null; category?: ImportCandidateCategory }

/** <video src>, <source src> (inside video or audio), with the poster as thumbnail. The element says what it is. */
function htmlMediaElements(html: string, base: string): Found[] {
  const found: Found[] = []
  for (const m of html.matchAll(/<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const category: ImportCandidateCategory = m[1]!.toLowerCase() === "audio" ? "audio" : "video"
    const attrs = m[2] ?? ""
    const poster = absolutePublic(/\bposter=["']([^"']+)["']/i.exec(attrs)?.[1], base)
    const title = cleanText(/\b(?:title|aria-label)=["']([^"']+)["']/i.exec(attrs)?.[1])
    const own = absolutePublic(/\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1], base)
    if (own) found.push({ url: own, thumbnail: poster, title, category })
    for (const s of (m[3] ?? "").matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const url = absolutePublic(s[1], base)
      if (url) found.push({ url, thumbnail: poster, title, category })
    }
  }
  return found
}

const GENERIC_LINK_TEXT = /^(download|download now|watch|play|view|open|link|here|click here|mp4|video|file|get|save)\s*[:.!]?$/i

/**
 * Links on the page straight to a media file (`<a href="clip.mp4">`), relative
 * or absolute. Listed, not followed: only the file's own address is kept.
 */
function directMediaLinks(html: string, base: string): Found[] {
  const found: Found[] = []
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = m[1] ?? ""
    if (!VIDEO_EXT.test(href) && !AUDIO_EXT.test(href)) continue
    const url = absolutePublic(href, base)
    if (!url) continue
    const text = cleanText((m[2] ?? "").replace(/<[^>]+>/g, " "), 120)
    // "Download" or "Watch" says nothing about which file; the file name does.
    const generic = !text || text.length <= 2 || GENERIC_LINK_TEXT.test(text)
    found.push({ url, thumbnail: null, title: generic ? null : text })
  }
  return found
}

function isMediaCandidate(url: string): boolean {
  if (DRM_HOST_HINT.test(url)) return false
  if (YTDLP_FIRST_HINT.test(url)) {
    // A platform's home or channel page is not one video.
    return canonicalMediaKey(url).startsWith("youtube:") || canonicalMediaKey(url).startsWith("vimeo:") || !/youtube|vimeo/i.test(url)
  }
  return VIDEO_EXT.test(url) || AUDIO_EXT.test(url)
}

function youtubeThumb(url: string): string | null {
  const key = canonicalMediaKey(url)
  return key.startsWith("youtube:") ? `https://i.ytimg.com/vi/${key.slice(8)}/hqdefault.jpg` : null
}

function fallbackTitle(url: string, index: number): string {
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last.slice(0, 120)
  } catch {
    // fall through
  }
  return `${sourceName(url)} video ${index + 1}`
}

/**
 * Media on one HTML page — not the pages it links to. Embedded players,
 * JSON-LD VideoObjects, <video>/<source> elements, Open Graph video and
 * direct media links, de-duplicated and capped at IMPORT_BATCH_MAX_ITEMS.
 */
export function extractPageCandidates(html: string, pageUrl: string): InspectedItem[] {
  const pageKey = canonicalMediaKey(pageUrl)
  const meta = jsonLdVideoMeta(html, pageUrl)
  const ordered: Found[] = []
  for (const el of htmlMediaElements(html, pageUrl)) ordered.push(el)
  for (const key of ["og:video:secure_url", "og:video:url", "og:video"]) {
    const url = absolutePublic(extractMetaContent(html, key), pageUrl)
    if (url) ordered.push({ url, thumbnail: null, title: null })
  }
  for (const url of extractEmbeddedPlayerUrls(html, pageUrl)) ordered.push({ url, thumbnail: null, title: null })
  for (const link of directMediaLinks(html, pageUrl)) ordered.push(link)

  const seen = new Set<string>([pageKey])
  const items: InspectedItem[] = []
  for (const entry of ordered) {
    if (!isMediaCandidate(entry.url)) continue
    const key = canonicalMediaKey(entry.url)
    if (seen.has(key)) continue
    seen.add(key)
    const m = meta.get(key)
    const url = importableMediaUrl(entry.url)
    items.push({
      url,
      title: m?.title ?? entry.title,
      thumbnail: m?.thumbnail ?? entry.thumbnail ?? youtubeThumb(url),
      durationSeconds: m?.durationSeconds ?? null,
      source: sourceName(url),
      category: entry.category ?? categoryForUrl(url),
    })
    if (items.length >= IMPORT_BATCH_MAX_ITEMS) break
  }
  return items.map((item, i) => ({ ...item, title: item.title ?? fallbackTitle(item.url, i) }))
}

/** Page title for the header of the picker. */
export function pageTitle(html: string): string | null {
  return cleanText(extractMetaContent(html, "og:title")) ?? cleanText(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1])
}

type YtDlpInfo = {
  _type?: string
  title?: unknown
  url?: unknown
  webpage_url?: unknown
  original_url?: unknown
  id?: unknown
  duration?: unknown
  thumbnail?: unknown
  thumbnails?: Array<{ url?: unknown }>
  extractor_key?: unknown
  ie_key?: unknown
  entries?: YtDlpInfo[]
}

function ytThumb(info: YtDlpInfo, base: string): string | null {
  const direct = absolutePublic(info.thumbnail, base)
  if (direct) return direct
  const list = Array.isArray(info.thumbnails) ? info.thumbnails : []
  for (let i = list.length - 1; i >= 0; i--) {
    const url = absolutePublic(list[i]?.url, base)
    if (url) return url
  }
  return null
}

function ytEntryUrl(entry: YtDlpInfo, base: string): string | null {
  for (const key of ["webpage_url", "url", "original_url"] as const) {
    const url = absolutePublic(entry[key], base)
    if (url) return importableMediaUrl(url)
  }
  if (typeof entry.id === "string" && /youtube/i.test(String(entry.ie_key ?? entry.extractor_key ?? ""))) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`
  }
  return null
}

/** yt-dlp's -J output → one item, or up to five from a playlist / channel / set. */
export function outcomeFromYtDlp(info: YtDlpInfo, requestedUrl: string): InspectOutcome {
  const entries = Array.isArray(info.entries) ? info.entries : null
  if (info._type === "playlist" || entries) {
    const seen = new Set<string>()
    const items: InspectedItem[] = []
    for (const entry of entries ?? []) {
      if (!entry || typeof entry !== "object") continue
      const url = ytEntryUrl(entry, requestedUrl)
      if (!url || DRM_HOST_HINT.test(url)) continue
      const key = canonicalMediaKey(url)
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        url,
        title: cleanText(entry.title) ?? fallbackTitle(url, items.length),
        thumbnail: ytThumb(entry, requestedUrl) ?? youtubeThumb(url),
        durationSeconds: isoDurationSeconds(entry.duration),
        source: sourceName(url),
        category: categoryForUrl(url),
      })
      if (items.length >= IMPORT_BATCH_MAX_ITEMS) break
    }
    const title = cleanText(info.title)
    if (items.length === 0) return { kind: "none", title, items: [], reason: null }
    if (items.length === 1) return { kind: "single", title: items[0]!.title, items, reason: null }
    return { kind: "collection", title, items, reason: null }
  }
  const url = ytEntryUrl(info, requestedUrl) ?? requestedUrl
  return {
    kind: "single",
    title: cleanText(info.title),
    items: [
      {
        url: requestedUrl,
        title: cleanText(info.title) ?? fallbackTitle(url, 0),
        thumbnail: ytThumb(info, requestedUrl) ?? youtubeThumb(url),
        durationSeconds: isoDurationSeconds(info.duration),
        source: sourceName(requestedUrl),
        category: categoryForUrl(requestedUrl),
      },
    ],
    reason: null,
  }
}

/**
 * What one HTML page amounts to. Two or more media items make a collection;
 * one is the existing single import of the page. With none, a page that has
 * an Open Graph image (a product page, an article) still imports that image
 * today, so it stays a single import; otherwise there is nothing to import.
 */
export function outcomeFromPage(html: string, pageUrl: string): InspectOutcome {
  const items = extractPageCandidates(html, pageUrl)
  const title = pageTitle(html)
  if (items.length >= 2) return { kind: "collection", title, items, reason: null }
  if (items.length === 1) {
    return { kind: "single", title, items: [{ ...items[0]!, url: pageUrl, title: title ?? items[0]!.title }], reason: null }
  }
  const image = absolutePublic(extractMetaContent(html, "og:image:secure_url") ?? extractMetaContent(html, "og:image"), pageUrl)
  if (image) {
    return {
      kind: "single",
      title,
      items: [
        {
          url: pageUrl,
          title: title ?? sourceName(pageUrl),
          thumbnail: image,
          durationSeconds: null,
          source: sourceName(pageUrl),
          // A video page's poster is not what the person is after: say video.
          category: htmlLooksLikeVideoPage(html, pageUrl) || VIDEO_PLATFORM_HINT.test(pageUrl) ? "video" : "image",
        },
      ],
      reason: null,
    }
  }
  return { kind: "none", title, items: [], reason: null }
}

/** Read at most maxBytes of a body, then stop the stream: a huge page cannot exhaust memory. */
export async function readTextCapped(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buf = chunk as Buffer
    const room = maxBytes - size
    chunks.push(room < buf.length ? buf.subarray(0, room) : buf)
    size += Math.min(room, buf.length)
    if (size >= maxBytes) {
      stream.destroy()
      break
    }
  }
  return Buffer.concat(chunks).toString("utf8")
}
