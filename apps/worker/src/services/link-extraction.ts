import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Reading media out of a link without downloading it: which hosts go to
 * yt-dlp, which are DRM-closed, and what an HTML page embeds (Open Graph,
 * JSON-LD VideoObject, iframe players, direct media links).
 *
 * Shared by the import pipeline (url-import.ts), which downloads what these
 * find, and link inspection (url-inspect.ts), which only lists it. Pure apart
 * from resolveBinary's file check: no network, no database.
 */

/** Video/social platforms yt-dlp handles far better than a raw fetch. */
export const VIDEO_PLATFORM_HINT =
  /(youtube\.com|youtu\.be|vimeo\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|dailymotion\.com|twitch\.tv|reddit\.com|streamable\.com)/i

/**
 * Streaming hosts that use DRM (or equivalent closed apps). yt-dlp will never
 * return a usable file — fail fast with a clear message instead of a generic
 * "could not find a downloadable file".
 */
export const DRM_HOST_HINT =
  /(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com|audible\.com|audible\.co\.uk|audible\.ca|audible\.de|audible\.fr|audible\.com\.au|netflix\.com|disneyplus\.com|hulu\.com|max\.com|hbomax\.com|primevideo\.com|amazon\.com\/gp\/video|music\.apple\.com|tv\.apple\.com|tidal\.com|deezer\.com|pandora\.com|crunchyroll\.com|peacocktv\.com|paramountplus\.com)/i

/** Instagram image posts and carousels need embed scraping; yt-dlp only handles reels/video. */
export const INSTAGRAM_HINT = /instagram\.com|instagr\.am/i

export function resolveBinary(name: string, envVar: string): string {
  const fromEnv = process.env[envVar]?.trim()
  if (fromEnv) return fromEnv
  const local = path.join(os.homedir(), ".local", "bin", name)
  if (existsSync(local)) return local
  return name
}

export function isPublicHttpUrl(rawUrl: string): boolean {
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

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

export function extractMetaContent(html: string, key: string): string | null {
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

export function htmlLooksLikeVideoPage(html: string, finalUrl: string): boolean {
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
export function extractEmbeddedPlayerUrls(html: string, baseUrl: string): string[] {
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

export function walkJsonLdForMedia(
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

export function drmBlockedMessage(rawUrl: string): string | null {
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
      "For podcasts, use the show’s public RSS / episode .mp3 if the publisher offers one, " +
      "or a YouTube / SoundCloud link. Music tracks cannot be imported."
    )
  }
  if (/audible/i.test(host) || /audible/i.test(rawUrl)) {
    return (
      "Audible audiobooks and podcasts are DRM-protected and cannot be downloaded. " +
      "Arciin only imports files you already own as a direct file, or public hosts like YouTube / SoundCloud."
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

const JSON_LD_MEDIA_TYPE = /^(VideoObject|AudioObject|MediaObject|Movie|TVEpisode|Episode|Clip|PodcastEpisode|MusicRecording|ImageObject|CreativeWork|Article|NewsArticle|BlogPosting)$/

/**
 * The `name` of the media a page describes in JSON-LD: a VideoObject /
 * AudioObject / Movie … first, any named top-level node otherwise. Bounded
 * walk; malformed blocks are skipped.
 */
export function extractJsonLdName(html: string): string | null {
  let fallback: string | null = null
  let found: string | null = null
  const visit = (node: unknown, depth: number) => {
    if (found || !node || depth > 6) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    if (typeof node !== "object") return
    const obj = node as Record<string, unknown>
    const types = ([] as unknown[]).concat(obj["@type"] ?? [])
    const name = typeof obj.name === "string" ? obj.name : typeof obj.headline === "string" ? obj.headline : null
    if (name && types.some((t) => typeof t === "string" && JSON_LD_MEDIA_TYPE.test(t))) {
      found = name
      return
    }
    if (name && depth <= 1 && !fallback) fallback = name
    for (const key of ["@graph", "mainEntity", "video", "audio", "associatedMedia"]) {
      if (obj[key]) visit(obj[key], depth + 1)
    }
  }
  for (const block of html.matchAll(
    /<script[^>]+type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = block[1]?.trim()
    if (!raw || raw.length > 512 * 1024) continue
    try {
      visit(JSON.parse(raw) as unknown, 0)
    } catch {
      // Not JSON; ignore the block.
    }
    if (found) break
  }
  return found ? decodeHtmlEntities(found) : fallback ? decodeHtmlEntities(fallback) : null
}
