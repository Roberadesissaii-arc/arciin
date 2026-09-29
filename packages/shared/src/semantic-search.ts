/**
 * Local semantic search — the pure core.
 *
 * An embedding model reads text, not pixels. So every asset becomes one
 * bounded piece of *semantic text* (what it is called, what it is about, and
 * for images a one-time local caption of what it shows), that text becomes
 * one vector, and a search is one more vector compared against those.
 *
 *   media → semantic text → nomic-embed-text → stored vector → similarity
 *
 * Everything here is pure (no I/O, no Node APIs), so the browser, the API and
 * the worker share one definition and it can be tested without Ollama.
 *
 * Storage: vectors are unit-length float32 in a BYTEA column and scored in the
 * API. pgvector is not installed on the target PostgreSQL 18 and would need an
 * OS package on the server, so it is left for a later, owner-approved
 * migration; brute-force cosine over a few thousand 768-d vectors takes a few
 * milliseconds.
 */

/** Bump when buildAssetSemanticText or the embedding recipe changes: every vector is then stale. */
export const SEMANTIC_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"
/** Dimensions of known embedding models; a response of any other length is rejected. */
export const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "nomic-embed-text": 768,
}
/**
 * nomic-embed-text reads 2,048 tokens. Text is capped well below that in
 * characters so nothing is silently truncated by the model.
 */
export const SEMANTIC_TEXT_MAX_CHARS = 2000
/** nomic-embed-text is trained with task prefixes; documents and queries use different ones. */
export const EMBED_DOCUMENT_PREFIX = "search_document: "
export const EMBED_QUERY_PREFIX = "search_query: "

/**
 * Cosine similarity at or above which a semantic hit is shown at all, and at
 * or above which it counts as a strong match. Measured, not guessed: with
 * nomic-embed-text over the controlled corpus in tests/fixtures (18 assets, 18
 * queries, 324 query/asset pairs; tests/semantic-live-ollama.test.ts),
 * re-run for v1.1.2 on the integrated code:
 *
 *   threshold  recall        false hits
 *   0.55        92% (23/25)   8 / 299
 *   0.58        92% (23/25)   4 / 299
 *   0.60        88% (22/25)   3 / 299
 *   0.62        80% (20/25)   0 / 299   ← chosen
 *   0.65        68% (17/25)   0 / 299
 *
 * The closest unrelated pair was 0.614 ("graduation ceremony" vs a wedding
 * video), so anything lower starts showing wrong files. At 0.62 every
 * answerable query's top result is right (15/15), and queries with no answer
 * in the corpus ("submarine", "tax return 1998") top out at 0.55 and return
 * nothing. IMG_0042 scores 0.79 for "birthday party" and 0.70 for "people
 * blowing out candles"; "beach sunset", "graduation ceremony" and "red car"
 * stay at 0.45–0.54.
 */
export const SEMANTIC_MIN_SIMILARITY = 0.62
export const SEMANTIC_STRONG_SIMILARITY = 0.7
/** Semantic hits added to one search, at most. */
export const SEMANTIC_MAX_RESULTS = 60

/** The version number stored on each row: schema version and the owner's rebuild count together. */
export function semanticIndexVersion(rebuildEpoch: number): number {
  return SEMANTIC_INDEX_SCHEMA_VERSION * 10_000 + Math.max(0, Math.floor(rebuildEpoch))
}

// ---------------------------------------------------------------------------
// Semantic text
// ---------------------------------------------------------------------------

export type SemanticAssetInput = {
  originalFilename: string
  title?: string | null
  description?: string | null
  mediaType: string
  libraryName?: string | null
  folderName?: string | null
  documentAuthor?: string | null
  documentSubject?: string | null
  /** Asset.documentInsight JSON: summary, keywords, topics, about … */
  documentInsight?: unknown
  /** One-time local vision caption (images; video thumbnails). */
  caption?: string | null
  durationSeconds?: number | null
  width?: number | null
  height?: number | null
  /** Existing media transcript text, if any. A bounded excerpt is used. */
  transcriptText?: string | null
  importSourceUrl?: string | null
}

/**
 * Anything that could be a credential or an internal identifier: long
 * unbroken runs of token-like characters, known Arciin secret prefixes, and
 * filesystem paths. They carry no meaning and must not be stored or embedded.
 */
function scrub(value: string): string {
  return value
    .replace(/\b(?:arc|frq|shr|sess|arciin)_[A-Za-z0-9_-]{8,}/gi, " ")
    .replace(/(?:^|\s)(?:\/[\w.-]+){2,}\/?/g, " ")
    .replace(/[A-Za-z]:\\[^\s]+/g, " ")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = scrub(value)
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function listOf(value: unknown, maxItems: number, maxEach = 40): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = clip(typeof item === "string" ? item : (item as { name?: unknown; label?: unknown })?.name ?? (item as { label?: unknown })?.label, maxEach)
    if (text && !out.includes(text)) out.push(text)
    if (out.length >= maxItems) break
  }
  return out
}

/** "IMG_0042.jpg" → "IMG 0042"; "birthday-cake_final.png" → "birthday cake final". */
export function readableFilename(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,6}$/, "")
  return base
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
}

const KIND_WORD: Record<string, string> = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  DOCUMENT: "document",
  CODE: "code file",
  ARCHIVE: "archive",
}

function durationWords(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 90) return `${Math.round(seconds)} seconds long`
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes long`
  return `${(seconds / 3600).toFixed(1)} hours long`
}

/**
 * The one definition of what an asset means, for embedding.
 *
 * Priority order, each field bounded, the whole capped at
 * SEMANTIC_TEXT_MAX_CHARS: title, caption, description, filename, document
 * metadata and insight, transcript excerpt, where it lives, what kind it is.
 * Paths, ids, URLs (only a source's host name survives) and anything
 * token-shaped are removed.
 */
export function buildAssetSemanticText(input: SemanticAssetInput): string {
  const parts: string[] = []
  const push = (label: string, value: string | null | undefined) => {
    if (value) parts.push(`${label}: ${value}`)
  }
  const kind = KIND_WORD[input.mediaType] ?? "file"

  push("Title", clip(input.title, 200))
  push("Shows", clip(input.caption, 600))
  push("Description", clip(input.description, 500))
  const name = readableFilename(input.originalFilename)
  push("File name", clip(name, 160))

  if (input.mediaType === "DOCUMENT" || input.documentInsight || input.documentAuthor || input.documentSubject) {
    push("Subject", clip(input.documentSubject, 200))
    push("Author", clip(input.documentAuthor, 120))
    const insight = (input.documentInsight && typeof input.documentInsight === "object" ? input.documentInsight : {}) as Record<string, unknown>
    push("Summary", clip(insight.summary, 700))
    push("About", clip(insight.about, 300))
    const keywords = listOf(insight.keywords, 15)
    if (keywords.length) push("Keywords", keywords.join(", "))
    const topics = listOf(insight.topics, 10)
    if (topics.length) push("Topics", topics.join(", "))
  }

  push("Transcript excerpt", clip(input.transcriptText, 500))

  const where = [clip(input.folderName, 80), clip(input.libraryName, 60)].filter(Boolean).join(" in ")
  const details = [
    kind,
    durationWords(input.durationSeconds),
    input.width && input.height ? (input.width >= input.height ? "landscape" : "portrait") : null,
  ].filter(Boolean)
  push("Kind", details.join(", "))
  if (where) push("Located in", where)
  if (input.importSourceUrl) {
    try {
      push("Source", new URL(input.importSourceUrl).hostname.replace(/^www\./, ""))
    } catch {
      /* not a URL: nothing to add */
    }
  }

  let text = parts.join("\n")
  if (text.length > SEMANTIC_TEXT_MAX_CHARS) text = `${text.slice(0, SEMANTIC_TEXT_MAX_CHARS - 1).trimEnd()}…`
  return text
}

/**
 * True when there is something to embed beyond the file name and kind. A
 * file called IMG_0042.jpg with no caption and no metadata has no meaning to
 * find; indexing it anyway would only add noise.
 */
export function hasMeaningfulSemanticText(input: SemanticAssetInput): boolean {
  const insight = input.documentInsight as { summary?: unknown } | null | undefined
  if (input.title || input.caption || input.description || input.transcriptText) return true
  if (input.documentSubject || (typeof insight?.summary === "string" && insight.summary.trim())) return true
  // A descriptive file name counts; a camera counter does not.
  const words = readableFilename(input.originalFilename)
    .split(" ")
    .filter((w) => /[a-z]{3,}/i.test(w) && !/^(img|dsc|dscn|pxl|vid|mov|screenshot|scan|image|photo|file|document|untitled|copy)$/i.test(w))
  return words.length > 0
}

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

export function normalizeVector(values: ArrayLike<number>): Float32Array {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]! * values[i]!
  const norm = Math.sqrt(sum)
  const out = new Float32Array(values.length)
  if (!(norm > 0) || !Number.isFinite(norm)) return out
  for (let i = 0; i < values.length; i++) out[i] = values[i]! / norm
  return out
}

/** Unit-length float32, little-endian — the BYTEA stored per asset. 768 dims = 3,072 bytes. */
export function encodeVector(values: ArrayLike<number>): Uint8Array {
  const unit = normalizeVector(values)
  const bytes = new Uint8Array(unit.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < unit.length; i++) view.setFloat32(i * 4, unit[i]!, true)
  return bytes
}

export function decodeVector(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.byteLength / 4)
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 4)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

/** Cosine similarity of two unit vectors is their dot product. Different lengths never compare. */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.NaN
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

export type ScoredId = { id: string; score: number }

/** The ids whose similarity to the query clears `minScore`, best first, at most `limit`. */
export function topBySimilarity(
  query: Float32Array,
  vectors: Iterable<[string, Float32Array]>,
  minScore = SEMANTIC_MIN_SIMILARITY,
  limit = SEMANTIC_MAX_RESULTS * 4,
): ScoredId[] {
  const hits: ScoredId[] = []
  for (const [id, vector] of vectors) {
    const score = dot(query, vector)
    if (score >= minScore) hits.push({ id, score })
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return hits.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Hybrid ranking
// ---------------------------------------------------------------------------

export type LiteralTier = 3 | 2 | 1
export type SearchMatch =
  | { kind: "exact" }
  | { kind: "literal" }
  | { kind: "semantic"; strength: "strong" | "related" }

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().normalize("NFKC").trim()
}

/** 3 = the filename (with or without extension) or title is the query; 2 = starts with it; 1 = contains it. */
export function literalTier(query: string, asset: { originalFilename: string; title?: string | null }): LiteralTier {
  const q = norm(query)
  const name = norm(asset.originalFilename)
  const stem = name.replace(/\.[a-z0-9]{1,6}$/, "")
  const title = norm(asset.title)
  if (q && (name === q || stem === q || title === q)) return 3
  if (q && (name.startsWith(q) || title.startsWith(q))) return 2
  return 1
}

export function semanticStrength(score: number): "strong" | "related" {
  return score >= SEMANTIC_STRONG_SIMILARITY ? "strong" : "related"
}

/**
 * Keyword search stays; meaning is added after it.
 *
 * Literal matches keep their place in front — exact name/title first, then
 * prefix, then contains (stable within each tier) — and semantic hits that
 * are not already there follow, strongest first. A vector hit never outranks
 * a file the person named exactly.
 */
export function mergeHybrid<T extends { id: string; originalFilename: string; title?: string | null }>(
  query: string,
  literal: T[],
  semantic: Array<{ item: T; score: number }>,
): Array<{ item: T; match: SearchMatch }> {
  const tiered = literal
    .map((item, index) => ({ item, index, tier: literalTier(query, item) }))
    .sort((a, b) => b.tier - a.tier || a.index - b.index)
  const out: Array<{ item: T; match: SearchMatch }> = tiered.map(({ item, tier }) => ({
    item,
    match: tier === 3 ? { kind: "exact" } : { kind: "literal" },
  }))
  const seen = new Set(literal.map((item) => item.id))
  for (const { item, score } of [...semantic].sort((a, b) => b.score - a.score)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push({ item, match: { kind: "semantic", strength: semanticStrength(score) } })
  }
  return out
}

/** What a person is told about a semantic hit. Never a number. */
export function semanticMatchLabel(match: SearchMatch | null | undefined): string | null {
  if (!match || match.kind !== "semantic") return null
  return match.strength === "strong" ? "Matched by meaning" : "Related by meaning"
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * Semantic search only ever talks to an Ollama on this machine or this
 * network: loopback, private (RFC 1918 / ULA / link-local) addresses, or a
 * single-label name such as a Docker service ("ollama"). Anything else — a
 * public host, ollama.com — is refused, so library content cannot leave.
 */
export function isLocalOllamaUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number]
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (host.includes(":")) return host === "::1" || /^f[cd]/.test(host) || host.startsWith("fe80:")
  // A single-label name resolves only on this host or its private network.
  return /^[a-z0-9-]+$/.test(host) || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")
}
