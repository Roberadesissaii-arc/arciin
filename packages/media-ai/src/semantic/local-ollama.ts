import { createHash } from "node:crypto"

import {
  EMBED_DOCUMENT_PREFIX,
  EMBED_QUERY_PREFIX,
  KNOWN_EMBEDDING_DIMENSIONS,
  SEMANTIC_TEXT_MAX_CHARS,
  isLocalOllamaUrl,
  normalizeVector,
} from "@arciin/shared"

/**
 * The local Ollama client for semantic search: embeddings, one-time image
 * captions, and model presence. Deliberately separate from the chat client,
 * which may be pointed at Ollama Cloud — nothing here will talk to anything
 * but an Ollama on this machine or its private network, and nothing here logs
 * the text it sends.
 */

export type SemanticErrorCode =
  | "NOT_LOCAL"
  | "OLLAMA_OFFLINE"
  | "MODEL_MISSING"
  | "TIMEOUT"
  | "BAD_RESPONSE"
  | "WRONG_DIMENSION"

export class SemanticOllamaError extends Error {
  constructor(
    readonly code: SemanticErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "SemanticOllamaError"
  }
  /** Worth retrying later: Ollama may come back, or finish loading. */
  get transient(): boolean {
    return this.code === "OLLAMA_OFFLINE" || this.code === "TIMEOUT"
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Where semantic search finds Ollama. ARCIIN_SEMANTIC_OLLAMA_URL, else the
 * standard local port. There is no fallback to any other provider.
 */
export function semanticOllamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.ARCIIN_SEMANTIC_OLLAMA_URL ?? "").trim() || "http://127.0.0.1:11434"
  return raw.replace(/\/+$/, "")
}

function assertLocal(baseUrl: string) {
  if (!isLocalOllamaUrl(baseUrl)) {
    throw new SemanticOllamaError("NOT_LOCAL", "Semantic search only uses an Ollama on this server or its local network.")
  }
}

async function call(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SemanticOllamaError("TIMEOUT", "Ollama did not answer in time.")
    }
    throw new SemanticOllamaError("OLLAMA_OFFLINE", "Ollama is not reachable.")
  }
}

async function failFrom(res: Response, model: string): Promise<never> {
  const text = (await res.text().catch(() => "")).toLowerCase()
  if (res.status === 404 || /not found|pull/.test(text)) {
    throw new SemanticOllamaError("MODEL_MISSING", `The model ${model} is not installed in Ollama.`)
  }
  throw new SemanticOllamaError("BAD_RESPONSE", `Ollama answered ${res.status}.`)
}

/** Most texts sent in one /api/embed call. */
export const EMBED_BATCH_SIZE = 4

/**
 * Embed texts locally. Returns unit-length vectors, one per text, in order.
 * Each text is bounded, prefixed for nomic's document/query tasks, and every
 * vector is checked: count, finiteness, and dimension.
 */
export async function embedTexts(input: {
  baseUrl: string
  model: string
  texts: string[]
  kind: "document" | "query"
  expectedDimension?: number
  timeoutMs?: number
  fetchImpl?: FetchLike
}): Promise<Float32Array[]> {
  assertLocal(input.baseUrl)
  const fetchImpl = input.fetchImpl ?? (fetch as FetchLike)
  const prefix = input.kind === "query" ? EMBED_QUERY_PREFIX : EMBED_DOCUMENT_PREFIX
  const usesPrefix = /nomic/i.test(input.model)
  const expected = input.expectedDimension ?? KNOWN_EMBEDDING_DIMENSIONS[input.model.replace(/:latest$/, "")]
  const out: Float32Array[] = []
  for (let start = 0; start < input.texts.length; start += EMBED_BATCH_SIZE) {
    const batch = input.texts.slice(start, start + EMBED_BATCH_SIZE).map((t) => {
      const bounded = String(t ?? "").slice(0, SEMANTIC_TEXT_MAX_CHARS)
      return usesPrefix ? `${prefix}${bounded}` : bounded
    })
    const res = await call(
      fetchImpl,
      `${input.baseUrl}/api/embed`,
      { model: input.model, input: batch, truncate: true },
      input.timeoutMs ?? 120_000,
    )
    if (!res.ok) await failFrom(res, input.model)
    let parsed: { embeddings?: unknown }
    try {
      parsed = (await res.json()) as { embeddings?: unknown }
    } catch {
      throw new SemanticOllamaError("BAD_RESPONSE", "Ollama sent something that is not JSON.")
    }
    const embeddings = parsed.embeddings
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
      throw new SemanticOllamaError("BAD_RESPONSE", "Ollama returned the wrong number of embeddings.")
    }
    for (const vector of embeddings) {
      if (!Array.isArray(vector) || vector.length === 0 || !vector.every((v) => typeof v === "number" && Number.isFinite(v))) {
        throw new SemanticOllamaError("BAD_RESPONSE", "Ollama returned an invalid embedding.")
      }
      const dimension = expected ?? out[0]?.length ?? vector.length
      if (vector.length !== dimension) {
        throw new SemanticOllamaError("WRONG_DIMENSION", `Expected ${dimension} dimensions, got ${vector.length}.`)
      }
      out.push(normalizeVector(vector as number[]))
    }
  }
  return out
}

export async function embedText(input: Omit<Parameters<typeof embedTexts>[0], "texts"> & { text: string }): Promise<Float32Array> {
  const [vector] = await embedTexts({ ...input, texts: [input.text] })
  return vector!
}

export type LocalModelInfo = {
  name: string
  digest: string | null
  sizeBytes: number | null
  capabilities: string[]
  dimension: number | null
}

export type OllamaModelStatus =
  | { ollama: "offline" }
  | { ollama: "online"; installed: false }
  | { ollama: "online"; installed: true; model: LocalModelInfo }

function sameModel(a: string, b: string): boolean {
  const n = (s: string) => (s.includes(":") ? s : `${s}:latest`)
  return n(a) === n(b)
}

/** Is Ollama up, and is this model installed? Digest and size come from Ollama itself. */
export async function localModelStatus(input: {
  baseUrl: string
  model: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<OllamaModelStatus> {
  assertLocal(input.baseUrl)
  const fetchImpl = input.fetchImpl ?? (fetch as FetchLike)
  let tags: { models?: Array<{ name?: string; model?: string; digest?: string; size?: number }> }
  try {
    const res = await call(fetchImpl, `${input.baseUrl}/api/tags`, undefined, input.timeoutMs ?? 4_000)
    if (!res.ok) return { ollama: "offline" }
    tags = (await res.json()) as typeof tags
  } catch {
    return { ollama: "offline" }
  }
  const found = (tags.models ?? []).find((m) => sameModel(String(m.name ?? m.model ?? ""), input.model))
  if (!found) return { ollama: "online", installed: false }
  let capabilities: string[] = []
  let dimension: number | null = null
  try {
    const res = await call(fetchImpl, `${input.baseUrl}/api/show`, { model: input.model }, input.timeoutMs ?? 4_000)
    if (res.ok) {
      const show = (await res.json()) as { capabilities?: unknown; model_info?: Record<string, unknown> }
      capabilities = Array.isArray(show.capabilities) ? show.capabilities.map(String) : []
      const dim = Object.entries(show.model_info ?? {}).find(([k]) => k.endsWith(".embedding_length"))?.[1]
      dimension = typeof dim === "number" ? dim : null
    }
  } catch {
    /* capabilities are a nicety */
  }
  return {
    ollama: "online",
    installed: true,
    model: {
      name: String(found.name ?? input.model),
      digest: found.digest ? String(found.digest) : null,
      sizeBytes: typeof found.size === "number" ? found.size : null,
      capabilities,
      dimension,
    },
  }
}

/** The first installed local model that can see images, preferring `preferred`. Null when there is none. */
export async function findLocalVisionModel(input: {
  baseUrl: string
  preferred?: string | null
  fetchImpl?: FetchLike
}): Promise<string | null> {
  assertLocal(input.baseUrl)
  const fetchImpl = input.fetchImpl ?? (fetch as FetchLike)
  let names: string[] = []
  try {
    const res = await call(fetchImpl, `${input.baseUrl}/api/tags`, undefined, 4_000)
    if (!res.ok) return null
    const tags = (await res.json()) as { models?: Array<{ name?: string }> }
    names = (tags.models ?? []).map((m) => String(m.name ?? "")).filter(Boolean)
  } catch {
    return null
  }
  const ordered = input.preferred ? [input.preferred, ...names.filter((n) => !sameModel(n, input.preferred!))] : names
  for (const name of ordered) {
    if (!names.some((n) => sameModel(n, name))) continue
    try {
      const res = await call(fetchImpl, `${input.baseUrl}/api/show`, { model: name }, 4_000)
      if (!res.ok) continue
      const show = (await res.json()) as { capabilities?: unknown }
      if (Array.isArray(show.capabilities) && show.capabilities.includes("vision")) return name
    } catch {
      /* next */
    }
  }
  return null
}

/**
 * CPU threads a caption may use. ARCIIN_SEMANTIC_OLLAMA_THREADS, default 2.
 * Measured on a 4-core host: uncapped captioning held ~3 cores and pushed a
 * concurrent query embedding from ~1 s to ~2.1 s.
 */
export function semanticCaptionThreads(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ARCIIN_SEMANTIC_OLLAMA_THREADS)
  return Number.isFinite(raw) && raw >= 1 && raw <= 64 ? Math.floor(raw) : 2
}

export const CAPTION_PROMPT =
  "Describe this picture in one or two plain sentences for a photo search index: " +
  "the main subjects, what they are doing, the setting, and any occasion or event it shows. " +
  "Do not guess who anyone is. Reply with the description only."

/**
 * One caption for one image, from a local vision model. Called once per
 * image at indexing time — never at search time.
 */
export async function captionImageLocally(input: {
  baseUrl: string
  model: string
  imageBase64: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}): Promise<string> {
  assertLocal(input.baseUrl)
  const fetchImpl = input.fetchImpl ?? (fetch as FetchLike)
  const res = await call(
    fetchImpl,
    `${input.baseUrl}/api/chat`,
    {
      model: input.model,
      stream: false,
      think: false,
      // Indexing is occasional: let the vision model leave memory soon after.
      keep_alive: "2m",
      // A thread cap keeps captioning from taking every core of a server that
      // also runs Arciin (and answers search queries meanwhile).
      options: { temperature: 0.1, num_predict: 120, num_thread: semanticCaptionThreads() },
      messages: [{ role: "user", content: CAPTION_PROMPT, images: [input.imageBase64] }],
    },
    // A CPU-only host takes ~40 s per 256px caption; leave generous room.
    input.timeoutMs ?? 300_000,
  )
  if (!res.ok) await failFrom(res, input.model)
  const json = (await res.json().catch(() => null)) as { message?: { content?: unknown } } | null
  const text = typeof json?.message?.content === "string" ? json.message.content : ""
  const caption = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600)
  if (!caption) throw new SemanticOllamaError("BAD_RESPONSE", "The vision model returned no description.")
  return caption
}

/**
 * Install a model into the local Ollama — only ever as an explicit owner
 * action. Streams Ollama's own progress (bytes and total), so the size shown
 * is Ollama's, not a hard-coded guess.
 */
export async function pullLocalModel(input: {
  baseUrl: string
  model: string
  onProgress?: (p: { status: string; completed: number | null; total: number | null }) => void
  fetchImpl?: FetchLike
}): Promise<void> {
  assertLocal(input.baseUrl)
  const fetchImpl = input.fetchImpl ?? (fetch as FetchLike)
  const res = await call(fetchImpl, `${input.baseUrl}/api/pull`, { model: input.model, stream: true }, 60 * 60 * 1000)
  if (!res.ok || !res.body) await failFrom(res, input.model)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const evt = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string }
        if (evt.error) throw new SemanticOllamaError("BAD_RESPONSE", "Ollama could not install the model.")
        input.onProgress?.({ status: String(evt.status ?? ""), completed: evt.completed ?? null, total: evt.total ?? null })
      } catch (error) {
        if (error instanceof SemanticOllamaError) throw error
      }
    }
  }
}

/** What an index row was built from. Equal fingerprints mean nothing needs re-embedding. */
export function semanticFingerprint(input: {
  embeddingModel: string
  embeddingDigest: string | null
  indexVersion: number
  semanticText: string
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([input.embeddingModel, input.embeddingDigest ?? "", input.indexVersion, input.semanticText]),
    )
    .digest("hex")
}
