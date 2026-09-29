import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SEMANTIC_MIN_SIMILARITY,
  SEMANTIC_STRONG_SIMILARITY,
  SEMANTIC_TEXT_MAX_CHARS,
  buildAssetSemanticText,
  decodeVector,
  dot,
  encodeVector,
  hasMeaningfulSemanticText,
  isLocalOllamaUrl,
  literalTier,
  mergeHybrid,
  normalizeVector,
  readableFilename,
  semanticIndexVersion,
  semanticMatchLabel,
  topBySimilarity,
} from "@arciin/shared"

import {
  EMBED_BATCH_SIZE,
  SemanticOllamaError,
  captionImageLocally,
  embedTexts,
  findLocalVisionModel,
  isRemoteOllamaModel,
  localModelStatus,
  semanticFingerprint,
  semanticOllamaBaseUrl,
} from "../packages/media-ai/src/semantic/local-ollama"

/**
 * Local semantic search without a model: the text builder, vectors, hybrid
 * ranking and the Ollama client against a fake server. The real model is
 * exercised by tests/semantic-live-ollama.test.ts (opt-in).
 */

const LOCAL = "http://127.0.0.1:11434"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildAssetSemanticText", () => {
  it("puts the image caption, title and description first", () => {
    const text = buildAssetSemanticText({
      originalFilename: "IMG_0042.jpg",
      mediaType: "IMAGE",
      title: "Sam's party",
      description: "Saturday afternoon",
      caption: "Friends gathered around a birthday cake while a person blows out candles.",
      libraryName: "Images",
      folderName: "2026",
    })
    expect(text).toContain("Title: Sam's party")
    expect(text).toContain("Shows: Friends gathered around a birthday cake")
    expect(text).toContain("Description: Saturday afternoon")
    expect(text).toContain("File name: IMG 0042")
    expect(text).toContain("Located in: 2026 in Images")
    expect(text.indexOf("Title")).toBeLessThan(text.indexOf("File name"))
  })

  it("documents use subject, author and the insight summary, keywords and topics", () => {
    const text = buildAssetSemanticText({
      originalFilename: "scan_0003.pdf",
      mediaType: "DOCUMENT",
      documentSubject: "Invoice",
      documentAuthor: "Acme Hosting",
      documentInsight: { summary: "Invoice for three months of hosting.", keywords: ["invoice", "billing"], topics: ["finance"], links: ["https://x.example/pay?token=abc"] },
    })
    expect(text).toContain("Subject: Invoice")
    expect(text).toContain("Author: Acme Hosting")
    expect(text).toContain("Summary: Invoice for three months of hosting.")
    expect(text).toContain("Keywords: invoice, billing")
    expect(text).toContain("Topics: finance")
    expect(text).not.toContain("x.example")
  })

  it("video and audio use duration and an existing transcript excerpt", () => {
    const text = buildAssetSemanticText({
      originalFilename: "AUD_0012.m4a",
      mediaType: "AUDIO",
      durationSeconds: 2700,
      transcriptText: "Today we talk about budgeting and saving money.",
    })
    expect(text).toContain("Transcript excerpt: Today we talk about budgeting")
    expect(text).toContain("Kind: audio, 45 minutes long")
  })

  it("never carries paths, ids, URLs or anything token-shaped", () => {
    const text = buildAssetSemanticText({
      originalFilename: "notes.txt",
      mediaType: "DOCUMENT",
      title: "see /srv/arciin-storage/arciin/objects/ab/cd.bin and C:\\Users\\me\\secret.txt",
      description:
        "key arc_36c76a3c0123456789abcdef0123456789 share shr_AbCdEfGhIjKlMnOpQrStUvWx link https://evil.example/?session=1 id cmabc1234567890abcdefghijklmnopq",
      importSourceUrl: "https://www.youtube.com/watch?v=abc&token=secret",
    })
    expect(text).not.toMatch(/\/srv\/|C:\\|arc_36c7|shr_AbC|evil\.example|session=|cmabc1234567890abcdefghijklmnopq|token=secret/)
    expect(text).toContain("Source: youtube.com")
  })

  it("is bounded however much metadata there is", () => {
    const long = "word ".repeat(5000)
    const text = buildAssetSemanticText({
      originalFilename: "a.pdf",
      mediaType: "DOCUMENT",
      title: long,
      description: long,
      caption: long,
      documentInsight: { summary: long, keywords: Array(100).fill("kw"), topics: Array(100).fill("t") },
      transcriptText: long,
    })
    expect(text.length).toBeLessThanOrEqual(SEMANTIC_TEXT_MAX_CHARS)
  })

  it("a camera file name alone has no meaning to index; a caption or a real name does", () => {
    expect(hasMeaningfulSemanticText({ originalFilename: "IMG_0042.jpg", mediaType: "IMAGE" })).toBe(false)
    expect(hasMeaningfulSemanticText({ originalFilename: "DSC_1180.JPG", mediaType: "IMAGE" })).toBe(false)
    expect(hasMeaningfulSemanticText({ originalFilename: "IMG_0042.jpg", mediaType: "IMAGE", caption: "a cake" })).toBe(true)
    expect(hasMeaningfulSemanticText({ originalFilename: "tax-return-2025.pdf", mediaType: "DOCUMENT" })).toBe(true)
  })

  it("readable file names", () => {
    expect(readableFilename("birthday-cake_final.png")).toBe("birthday cake final")
    expect(readableFilename("VacationPhotosRome.jpeg")).toBe("Vacation Photos Rome")
  })
})

describe("vectors", () => {
  it("round-trip as unit-length float32, 3,072 bytes for 768 dimensions", () => {
    const raw = Array.from({ length: 768 }, (_, i) => Math.sin(i) * 3)
    const bytes = encodeVector(raw)
    expect(bytes.byteLength).toBe(3072)
    const back = decodeVector(bytes)
    expect(dot(back, back)).toBeCloseTo(1, 5)
    expect(dot(back, normalizeVector(raw))).toBeCloseTo(1, 5)
  })

  it("vectors of different lengths never compare", () => {
    expect(Number.isNaN(dot(new Float32Array(3), new Float32Array(4)))).toBe(true)
  })

  it("ranks by cosine, drops what is below the threshold, and caps", () => {
    const q = normalizeVector([1, 0, 0])
    const vectors: Array<[string, Float32Array]> = [
      ["far", normalizeVector([0, 1, 0])],
      ["near", normalizeVector([1, 0.2, 0])],
      ["nearest", normalizeVector([1, 0.05, 0])],
      ["edge", normalizeVector([SEMANTIC_MIN_SIMILARITY - 0.01, Math.sqrt(1 - (SEMANTIC_MIN_SIMILARITY - 0.01) ** 2), 0])],
    ]
    const hits = topBySimilarity(q, vectors)
    expect(hits.map((h) => h.id)).toEqual(["nearest", "near"])
    expect(topBySimilarity(q, vectors, SEMANTIC_MIN_SIMILARITY, 1).map((h) => h.id)).toEqual(["nearest"])
  })

  it("the index version changes with the schema and each rebuild", () => {
    expect(semanticIndexVersion(0)).not.toBe(semanticIndexVersion(1))
  })

  it("fingerprints change with model, build, version or text — and only then", () => {
    const base = { embeddingModel: "nomic-embed-text", embeddingDigest: "d1", indexVersion: 10000, semanticText: "a" }
    const fp = semanticFingerprint(base)
    expect(semanticFingerprint({ ...base })).toBe(fp)
    for (const change of [{ embeddingModel: "other" }, { embeddingDigest: "d2" }, { indexVersion: 10001 }, { semanticText: "b" }]) {
      expect(semanticFingerprint({ ...base, ...change })).not.toBe(fp)
    }
  })
})

describe("hybrid ranking", () => {
  const a = (id: string, originalFilename: string, title: string | null = null) => ({ id, originalFilename, title })

  it("an exact file name or title beats everything; prefix before contains; semantic after all literal", () => {
    const literal = [a("contains", "my-birthday.jpg"), a("prefix", "birthday-2024.jpg"), a("exact", "birthday.png"), a("title", "x.jpg", "Birthday")]
    const semantic = [{ item: a("sem", "IMG_0042.jpg"), score: 0.95 }]
    const out = mergeHybrid("birthday", literal, semantic)
    expect(out.map((r) => r.item.id)).toEqual(["exact", "title", "prefix", "contains", "sem"])
    expect(out[0]!.match).toEqual({ kind: "exact" })
    expect(out.at(-1)!.match).toEqual({ kind: "semantic", strength: "strong" })
  })

  it("a file found both ways appears once, as a literal match", () => {
    const shared = a("both", "birthday.jpg")
    const out = mergeHybrid("birthday", [shared], [{ item: shared, score: 0.9 }, { item: a("s", "x.jpg"), score: 0.7 }])
    expect(out.map((r) => r.item.id)).toEqual(["both", "s"])
    expect(out[0]!.match.kind).toBe("exact")
  })

  it("semantic hits are ordered by similarity and labelled in words, never numbers", () => {
    const out = mergeHybrid("x", [], [
      { item: a("weak", "a.jpg"), score: SEMANTIC_MIN_SIMILARITY + 0.01 },
      { item: a("strong", "b.jpg"), score: SEMANTIC_STRONG_SIMILARITY + 0.05 },
    ])
    expect(out.map((r) => r.item.id)).toEqual(["strong", "weak"])
    expect(semanticMatchLabel(out[0]!.match)).toBe("Matched by meaning")
    expect(semanticMatchLabel(out[1]!.match)).toBe("Related by meaning")
    expect(semanticMatchLabel({ kind: "exact" })).toBeNull()
    for (const r of out) expect(semanticMatchLabel(r.match)).not.toMatch(/\d/)
  })

  it("literal tiers", () => {
    expect(literalTier("IMG_0042", { originalFilename: "IMG_0042.jpg" })).toBe(3)
    expect(literalTier("img", { originalFilename: "IMG_0042.jpg" })).toBe(2)
    expect(literalTier("0042", { originalFilename: "IMG_0042.jpg" })).toBe(1)
  })
})

describe("local only", () => {
  it.each(["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434", "http://192.168.1.20:11434", "http://10.0.0.5:11434", "http://ollama:11434", "http://gpu-box.local:11434"])(
    "%s is local",
    (url) => expect(isLocalOllamaUrl(url)).toBe(true),
  )
  it.each(["https://ollama.com", "https://api.openai.com/v1", "http://8.8.8.8:11434", "https://embeddings.example.com", "http://user:pw@127.0.0.1:11434", "ftp://127.0.0.1"])(
    "%s is refused",
    (url) => expect(isLocalOllamaUrl(url)).toBe(false),
  )
  it("the default is the local port", () => {
    expect(semanticOllamaBaseUrl({})).toBe("http://127.0.0.1:11434")
  })
})

/** A fake Ollama. `vector(text)` decides each embedding. */
function fakeOllama(opts: {
  vector?: (text: string) => number[]
  status?: number
  body?: unknown
  throwOnFetch?: Error
  tags?: string[]
}) {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body })
    if (opts.throwOnFetch) throw opts.throwOnFetch
    if (url.endsWith("/api/tags")) return Response.json({ models: (opts.tags ?? ["nomic-embed-text:latest"]).map((name) => ({ name, digest: "abc123", size: 274_000_000 })) })
    if (url.endsWith("/api/show")) return Response.json({ capabilities: ["embedding"], model_info: { "nomic-bert.embedding_length": 768 } })
    if (opts.status && opts.status !== 200) return new Response(JSON.stringify({ error: "model \"x\" not found, try pulling it first" }), { status: opts.status })
    if (opts.body !== undefined) return Response.json(opts.body)
    const input = (body as { input: string[] }).input
    return Response.json({ embeddings: input.map((t) => (opts.vector ?? (() => Array(768).fill(0.1)))(t)) })
  }
  return { fetchImpl, calls }
}

describe("embedding client", () => {
  it("returns one unit vector per text, prefixed for nomic, in batches", async () => {
    const fake = fakeOllama({})
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 2 + 1 }, (_, i) => `t${i}`)
    const out = await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts, kind: "document", fetchImpl: fake.fetchImpl })
    expect(out).toHaveLength(texts.length)
    expect(dot(out[0]!, out[0]!)).toBeCloseTo(1, 5)
    expect(fake.calls).toHaveLength(3)
    expect((fake.calls[0]!.body as { input: string[] }).input[0]).toBe("search_document: t0")
    const q = await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["cake"], kind: "query", fetchImpl: fake.fetchImpl })
    expect(q).toHaveLength(1)
    expect((fake.calls.at(-1)!.body as { input: string[] }).input[0]).toBe("search_query: cake")
  })

  it("bounds each input", async () => {
    const fake = fakeOllama({})
    await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["x".repeat(50_000)], kind: "document", fetchImpl: fake.fetchImpl })
    expect((fake.calls[0]!.body as { input: string[] }).input[0]!.length).toBeLessThanOrEqual(SEMANTIC_TEXT_MAX_CHARS + 20)
  })

  it.each([
    ["not an array", { embeddings: "nope" }, "BAD_RESPONSE"],
    ["wrong count", { embeddings: [] }, "BAD_RESPONSE"],
    ["non-numbers", { embeddings: [["a", "b"]] }, "BAD_RESPONSE"],
    ["NaN", { embeddings: [[Number.NaN]] }, "BAD_RESPONSE"],
    ["wrong dimension", { embeddings: [Array(384).fill(0.1)] }, "WRONG_DIMENSION"],
  ])("rejects a malformed response: %s", async (_label, body, code) => {
    const fake = fakeOllama({ body })
    await expect(embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["x"], kind: "document", fetchImpl: fake.fetchImpl })).rejects.toMatchObject({ code })
  })

  it("Ollama unreachable, model missing and timeouts are distinct, and only the first and last are transient", async () => {
    const offline = fakeOllama({ throwOnFetch: new TypeError("fetch failed") })
    const e1 = await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["x"], kind: "document", fetchImpl: offline.fetchImpl }).catch((e) => e)
    expect(e1).toMatchObject({ code: "OLLAMA_OFFLINE", transient: true })
    const missing = fakeOllama({ status: 404 })
    const e2 = await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["x"], kind: "document", fetchImpl: missing.fetchImpl }).catch((e) => e)
    expect(e2).toMatchObject({ code: "MODEL_MISSING", transient: false })
    const slow = fakeOllama({ throwOnFetch: Object.assign(new Error("t"), { name: "TimeoutError" }) })
    const e3 = await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["x"], kind: "document", fetchImpl: slow.fetchImpl }).catch((e) => e)
    expect(e3).toMatchObject({ code: "TIMEOUT", transient: true })
  })

  it("a real timeout aborts the request", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
    await expect(
      embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: ["x"], kind: "query", timeoutMs: 30, fetchImpl: hang }),
    ).rejects.toMatchObject({ code: "TIMEOUT" })
  })

  it("never sends anything to a non-local host — no cloud fallback", async () => {
    const fake = fakeOllama({})
    for (const baseUrl of ["https://ollama.com", "https://api.openai.com", "http://8.8.8.8:11434"]) {
      await expect(embedTexts({ baseUrl, model: "nomic-embed-text", texts: ["private text"], kind: "document", fetchImpl: fake.fetchImpl })).rejects.toBeInstanceOf(SemanticOllamaError)
      await expect(captionImageLocally({ baseUrl, model: "llava", imageBase64: "AAAA", fetchImpl: fake.fetchImpl })).rejects.toMatchObject({ code: "NOT_LOCAL" })
    }
    expect(fake.calls).toEqual([])
  })

  it("logs nothing of the text it embeds", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const secretText = "Private diary entry about my medical appointment"
    await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: [secretText], kind: "document", fetchImpl: fakeOllama({}).fetchImpl })
    await embedTexts({ baseUrl: LOCAL, model: "nomic-embed-text", texts: [secretText], kind: "document", fetchImpl: fakeOllama({ status: 500 }).fetchImpl }).catch(() => {})
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("medical")
  })

  it("model status reports digest, size and dimension from Ollama itself", async () => {
    const fake = fakeOllama({})
    const status = await localModelStatus({ baseUrl: LOCAL, model: "nomic-embed-text", fetchImpl: fake.fetchImpl })
    expect(status).toMatchObject({ ollama: "online", installed: true, model: { digest: "abc123", sizeBytes: 274_000_000, dimension: 768 } })
    expect(await localModelStatus({ baseUrl: LOCAL, model: "nomic-embed-text", fetchImpl: fakeOllama({ tags: ["llama3:latest"] }).fetchImpl })).toEqual({ ollama: "online", installed: false })
    expect(await localModelStatus({ baseUrl: LOCAL, model: "nomic-embed-text", fetchImpl: fakeOllama({ throwOnFetch: new Error("x") }).fetchImpl })).toEqual({ ollama: "offline" })
  })

  it("never picks an Ollama cloud model, even when it is installed and preferred", async () => {
    // Listed by the local Ollama, but served from ollama.com: images and text
    // would leave the machine.
    const models = [
      { name: "qwen3-vl:235b-cloud", remote_host: "https://ollama.com:443", remote_model: "qwen3-vl:235b" },
      { name: "gemma3:cloud" },
      { name: "nomic-embed-text:latest", digest: "abc", size: 1, remote_host: "https://ollama.com:443" },
      { name: "qwen3.5:0.8b", digest: "q", size: 1 },
    ]
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/tags")) return Response.json({ models })
      const { model } = JSON.parse(String(init?.body)) as { model: string }
      const entry = models.find((m) => m.name === model)
      return Response.json({ capabilities: ["completion", "vision"], ...(entry?.remote_host ? { remote_host: entry.remote_host } : {}) })
    }
    expect(isRemoteOllamaModel({ name: "gemma3:cloud" })).toBe(true)
    expect(isRemoteOllamaModel({ name: "qwen3.5:0.8b" })).toBe(false)
    expect(await findLocalVisionModel({ baseUrl: LOCAL, preferred: "qwen3-vl:235b-cloud", fetchImpl: fetchImpl as never })).toBe("qwen3.5:0.8b")
    expect(await localModelStatus({ baseUrl: LOCAL, model: "nomic-embed-text", fetchImpl: fetchImpl as never })).toEqual({ ollama: "online", installed: false })
    // With only cloud models, there is simply no vision model.
    models.splice(3, 1)
    expect(await findLocalVisionModel({ baseUrl: LOCAL, fetchImpl: fetchImpl as never })).toBeNull()
  })

  it("captions are single, trimmed, bounded, and free of thinking tags", async () => {
    const fetchImpl = async () => Response.json({ message: { content: `<think>hmm</think>  A cake with candles. ${"x".repeat(2000)}` } })
    const caption = await captionImageLocally({ baseUrl: LOCAL, model: "qwen3.5:0.8b", imageBase64: "AAAA", fetchImpl })
    expect(caption.startsWith("A cake with candles.")).toBe(true)
    expect(caption.length).toBeLessThanOrEqual(600)
  })
})
