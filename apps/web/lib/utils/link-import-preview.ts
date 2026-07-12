import { detectAssetSource, type AssetSourceInfo } from "@/lib/utils/asset-source"

export type LinkContentCategory =
  | "video"
  | "audio"
  | "image"
  | "document"
  | "product"
  | "gallery"
  | "social"
  | "direct-file"
  | "web"

export type LinkImportFormatId =
  | "video-mp4"
  | "video-best"
  | "audio-mp3"
  | "audio-m4a"
  | "original"

export type LinkImportFormat = {
  id: LinkImportFormatId
  label: string
  subtitle: string
  audioOnly: boolean
  audioFormat?: "mp3" | "m4a"
  videoFormat?: "mp4" | "best"
}

export type LinkImportTool = {
  id: string
  label: string
  value: string
}

export type LinkImportPreview = {
  source: AssetSourceInfo
  category: LinkContentCategory
  categoryLabel: string
  destinationLibrary: string
  hostname: string
  displayPath: string
  fileExtension: string | null
  importMethod: string
  formats: LinkImportFormat[]
  defaultFormatId: LinkImportFormatId
  tools: LinkImportTool[]
  hints: string[]
}

const VIDEO_SOURCES = new Set([
  "youtube",
  "vimeo",
  "tiktok",
  "x",
  "facebook",
  "dailymotion",
  "twitch",
  "linkedin",
  "reddit",
])

const AUDIO_SOURCES = new Set(["soundcloud", "spotify"])

const IMAGE_SOURCES = new Set([
  "unsplash",
  "pexels",
  "imgur",
  "flickr",
  "giphy",
  "dribbble",
  "behance",
])

const PRODUCT_SOURCES = new Set([
  "amazon",
  "walmart",
  "target",
  "etsy",
  "ebay",
  "aliexpress",
])

const GALLERY_SOURCES = new Set(["pinterest", "instagram", "tumblr"])

const DIRECT_FILE_EXT: Record<string, { category: LinkContentCategory; library: string }> = {
  mp4: { category: "video", library: "Videos" },
  webm: { category: "video", library: "Videos" },
  mkv: { category: "video", library: "Videos" },
  mov: { category: "video", library: "Videos" },
  avi: { category: "video", library: "Videos" },
  mp3: { category: "audio", library: "Music" },
  m4a: { category: "audio", library: "Music" },
  wav: { category: "audio", library: "Music" },
  flac: { category: "audio", library: "Music" },
  ogg: { category: "audio", library: "Music" },
  jpg: { category: "image", library: "Images" },
  jpeg: { category: "image", library: "Images" },
  png: { category: "image", library: "Images" },
  gif: { category: "image", library: "Images" },
  webp: { category: "image", library: "Images" },
  svg: { category: "image", library: "Images" },
  pdf: { category: "document", library: "Documents" },
  doc: { category: "document", library: "Documents" },
  docx: { category: "document", library: "Documents" },
}

const VIDEO_FORMATS: LinkImportFormat[] = [
  {
    id: "video-mp4",
    label: "MP4 video",
    subtitle: "Full video with audio, saved as MP4",
    audioOnly: false,
    videoFormat: "mp4",
  },
  {
    id: "video-best",
    label: "Best quality",
    subtitle: "Highest quality video the source allows",
    audioOnly: false,
    videoFormat: "best",
  },
  {
    id: "audio-mp3",
    label: "MP3 audio",
    subtitle: "Extract soundtrack only as MP3",
    audioOnly: true,
    audioFormat: "mp3",
  },
  {
    id: "audio-m4a",
    label: "M4A audio",
    subtitle: "Extract soundtrack only as M4A",
    audioOnly: true,
    audioFormat: "m4a",
  },
]

const ORIGINAL_FORMAT: LinkImportFormat = {
  id: "original",
  label: "Original file",
  subtitle: "Download the file as-is from the link",
  audioOnly: false,
}

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function extensionFromPath(pathname: string): string | null {
  const last = pathname.split("/").filter(Boolean).pop()
  if (!last) return null
  const match = last.match(/\.([a-z0-9]{1,8})$/i)
  return match?.[1]?.toLowerCase() ?? null
}

function categoryLabel(category: LinkContentCategory): string {
  switch (category) {
    case "video":
      return "Video"
    case "audio":
      return "Audio"
    case "image":
      return "Image"
    case "document":
      return "Document"
    case "product":
      return "Product page"
    case "gallery":
      return "Gallery"
    case "social":
      return "Social post"
    case "direct-file":
      return "Direct file"
    default:
      return "Web link"
  }
}

function inferCategory(
  sourceKey: string,
  ext: string | null,
): { category: LinkContentCategory; library: string } {
  if (ext && DIRECT_FILE_EXT[ext]) {
    return {
      category: DIRECT_FILE_EXT[ext].category,
      library: DIRECT_FILE_EXT[ext].library,
    }
  }
  if (VIDEO_SOURCES.has(sourceKey)) {
    return { category: "video", library: "Videos" }
  }
  if (AUDIO_SOURCES.has(sourceKey)) {
    return { category: "audio", library: "Music" }
  }
  if (IMAGE_SOURCES.has(sourceKey)) {
    return { category: "image", library: "Images" }
  }
  if (PRODUCT_SOURCES.has(sourceKey)) {
    return { category: "product", library: "Images" }
  }
  if (GALLERY_SOURCES.has(sourceKey)) {
    return { category: "gallery", library: "Images" }
  }
  if (sourceKey === "github") {
    return { category: "direct-file", library: "Inbox" }
  }
  return { category: "web", library: "Inbox" }
}

function importMethodFor(category: LinkContentCategory, sourceKey: string): string {
  if (sourceKey === "instagram") {
    return "Instagram embed + yt-dlp"
  }
  if (VIDEO_SOURCES.has(sourceKey) || category === "video") {
    return "yt-dlp video extractor"
  }
  if (AUDIO_SOURCES.has(sourceKey)) {
    return "yt-dlp audio extractor"
  }
  if (GALLERY_SOURCES.has(sourceKey) || category === "gallery") {
    return "gallery-dl"
  }
  if (category === "direct-file") {
    return "Direct HTTP download"
  }
  if (PRODUCT_SOURCES.has(sourceKey)) {
    return "Open Graph + direct fetch"
  }
  return "Smart fetch (direct, yt-dlp, or page meta)"
}

/** Rich preview for the import-from-link dialog. */
export function analyzeImportLink(rawUrl: string): LinkImportPreview | null {
  const trimmed = rawUrl.trim()
  if (!looksLikeUrl(trimmed)) return null

  const source = detectAssetSource(trimmed)
  if (!source) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  const ext = extensionFromPath(parsed.pathname)
  const { category, library } = inferCategory(source.key, ext)

  const formats: LinkImportFormat[] =
    category === "video" || VIDEO_SOURCES.has(source.key)
      ? VIDEO_FORMATS
      : [ORIGINAL_FORMAT]

  const defaultFormatId: LinkImportFormatId =
    category === "video" || VIDEO_SOURCES.has(source.key) ? "video-mp4" : "original"

  const tools: LinkImportTool[] = [
    { id: "method", label: "Import method", value: importMethodFor(category, source.key) },
    { id: "library", label: "Destination", value: `${library} library` },
  ]

  if (ext) {
    tools.push({ id: "ext", label: "File type", value: ext.toUpperCase() })
  }

  const hints: string[] = []
  if (category === "video" || VIDEO_SOURCES.has(source.key)) {
    hints.push("Choose MP4 for the full video or MP3/M4A for audio-only.")
    hints.push("Playlists are skipped — only the linked item is imported.")
    if (source.key === "facebook") {
      hints.push("Facebook reels and watch links are supported. Private posts may need cookies on the server.")
    }
  } else if (PRODUCT_SOURCES.has(source.key)) {
    hints.push("Product pages import the main image or media Arciin can find on the page.")
  } else if (category === "gallery") {
    if (source.key === "instagram") {
      hints.push("Photo posts download from Instagram's public embed. Carousels import one image at a time.")
      hints.push("Add ?img_index=2 to the link to import a specific slide from a carousel.")
      hints.push("Reels and video posts import as MP4 when available.")
    } else {
      hints.push("Gallery links import the first item from the post or album.")
    }
  } else if (category === "direct-file") {
    hints.push("Direct file links download without conversion.")
  } else {
    hints.push("Arciin tries direct download, then yt-dlp, gallery-dl, and page metadata.")
  }

  const displayPath = parsed.pathname.length > 48 ? `${parsed.pathname.slice(0, 45)}…` : parsed.pathname

  return {
    source,
    category,
    categoryLabel: categoryLabel(category),
    destinationLibrary: library,
    hostname: parsed.hostname.replace(/^www\./, ""),
    displayPath: displayPath || "/",
    fileExtension: ext,
    importMethod: importMethodFor(category, source.key),
    formats,
    defaultFormatId,
    tools,
    hints,
  }
}

export function formatToImportOptions(format: LinkImportFormat) {
  return {
    audioOnly: format.audioOnly,
    audioFormat: format.audioFormat,
    videoFormat: format.videoFormat,
  }
}

/** Whether this link supports MP4 / audio extraction options (video platforms). */
export function linkSupportsFormatOptions(preview: LinkImportPreview | null): boolean {
  if (!preview) return false
  return preview.formats.length > 1 && preview.formats.some((f) => f.id !== "original")
}

export { brandMarkForSource } from "@/lib/utils/source-brand-icon"
