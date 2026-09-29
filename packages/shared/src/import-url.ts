/**
 * Link import: the one place a typed or pasted link becomes a URL.
 *
 * People type `google.com` or `youtube.com/watch?v=…`, not `https://…`. Both
 * the browser (for the preview) and the API (which is the authority, and also
 * serves API clients) run input through this before anything else looks at
 * it. Normalising never makes a link safe: the result still goes through the
 * public-address / SSRF guard, which is where `http://192.168.1.10/` or
 * `localhost` is refused.
 *
 * Pure: no DNS, no network, works the same in the browser and in Node.
 */

/** Candidates an inspection returns, and items one batch import accepts. */
export const IMPORT_BATCH_MAX_ITEMS = 5
/** Imports actively downloading per user; the rest of a batch waits its turn. */
export const IMPORT_MAX_ACTIVE_PER_USER = 3

export type NormalizedImportUrl =
  | { ok: true; url: string; /** A scheme was added (the input had none). */ assumedHttps: boolean }
  | { ok: false; reason: string }

const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i
/** Schemes that are never a web link, written with or without slashes. */
const FORBIDDEN_SCHEME = /^(javascript|data|file|ftp|ftps|sftp|blob|chrome|chrome-extension|about|vbscript|mailto|tel|ws|wss|view-source|intent|content|filesystem):/i
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** `[label](https://…)` and `<https://…>`, as a link copied out of chat or Markdown arrives. */
function unwrap(input: string): string {
  const markdown = /^\[[^\]]*\]\(([^)\s]+)\)$/.exec(input)
  if (markdown) return markdown[1]!
  const angle = /^<([^>\s]+)>$/.exec(input)
  if (angle) return angle[1]!
  return input
}

function plausibleHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "")
  if (!host) return false
  if (host.startsWith("[") && host.endsWith("]")) return true // IPv6 literal, parsed by URL already
  if (IPV4.test(host)) return true
  if (host === "localhost") return true // well-formed; the SSRF guard refuses it
  const labels = host.split(".")
  if (labels.length < 2) return false
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false
  const tld = labels[labels.length - 1]!
  return /^[a-z]{2,63}$/i.test(tld) || /^xn--[a-z0-9-]{2,59}$/i.test(tld)
}

/**
 * `google.com` → `https://google.com/`; `https://x.test/a.mp4` unchanged;
 * `http://…` stays http (the guard decides). Refuses non-web schemes,
 * credentials in the URL, and anything that is not a plausible host.
 */
export function normalizeImportUrl(raw: string): NormalizedImportUrl {
  const input = unwrap(String(raw ?? "").trim())
  if (!input) return { ok: false, reason: "Enter a link to import." }
  if (input.length > 2048) return { ok: false, reason: "That link is too long." }
  if (/\s/.test(input)) return { ok: false, reason: "A link cannot contain spaces." }
  if (FORBIDDEN_SCHEME.test(input)) {
    return { ok: false, reason: "Only web links (http or https) can be imported." }
  }

  let candidate = input
  let assumedHttps = false
  const scheme = EXPLICIT_SCHEME.exec(input)?.[1]?.toLowerCase()
  if (scheme) {
    if (scheme !== "http" && scheme !== "https") {
      return { ok: false, reason: "Only web links (http or https) can be imported." }
    }
  } else if (input.startsWith("//")) {
    candidate = `https:${input}`
    assumedHttps = true
  } else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(input) && !/^[^/?#]*\.[^/?#]*:\d/.test(input)) {
    // "something:" that is not "host:port" — an unknown scheme, not a host.
    return { ok: false, reason: "Only web links (http or https) can be imported." }
  } else {
    candidate = `https://${input}`
    assumedHttps = true
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: "That does not look like a link." }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only web links (http or https) can be imported." }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Links with a username or password in them cannot be imported." }
  }
  if (!plausibleHost(url.hostname)) {
    return { ok: false, reason: "That does not look like a link." }
  }
  return { ok: true, url: url.toString(), assumedHttps }
}

// ---------------------------------------------------------------------------
// Inspection result, shared by the API response and the web client
// ---------------------------------------------------------------------------

export type ImportCandidateCategory = "video" | "audio" | "image" | "document" | "file"

/** One media item found at a link. `id` is opaque; the URL is re-read server-side at import. */
export type ImportCandidate = {
  id: string
  url: string
  title: string
  thumbnail: string | null
  durationSeconds: number | null
  source: string
  category: ImportCandidateCategory
}

export type ImportInspectionKind =
  /** One item: the existing single-import flow applies. */
  | "single"
  /** Several items: pick up to IMPORT_BATCH_MAX_ITEMS. */
  | "collection"
  /** Nothing downloadable was found. */
  | "none"
  /** A DRM / closed host. */
  | "blocked"

export type ImportInspection = {
  /** Reference for a batch import; the server keeps the candidate URLs under it. */
  inspectionId: string
  url: string
  kind: ImportInspectionKind
  title: string | null
  items: ImportCandidate[]
  /** Why the link cannot be imported, when kind is "blocked". */
  reason: string | null
}
