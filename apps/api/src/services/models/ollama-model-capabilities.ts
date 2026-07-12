import type Redis from "ioredis"

export type OllamaModelCapabilityEntry = {
  model: string
  capabilities: string[]
  vision: boolean
  thinking: boolean
}

const SHOW_CONCURRENCY = 6
const SHOW_TIMEOUT_MS = 18_000
const MEMORY_TTL_MS = 30 * 60_000
const REDIS_PREFIX = "arciin:ollama-cap:v1:"
const REDIS_TTL_SEC = 7 * 24 * 60 * 60

const memoryCache = new Map<string, { expiresAt: number; entry: OllamaModelCapabilityEntry }>()

function cacheKey(profileId: string, model: string): string {
  return `${profileId}:${model}`
}

function parseCapabilities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is string => typeof c === "string")
}

function entryFromShow(model: string, body: Record<string, unknown>): OllamaModelCapabilityEntry {
  const capabilities = parseCapabilities(body.capabilities)
  const lower = capabilities.map((c) => c.toLowerCase())
  return {
    model,
    capabilities,
    vision: lower.includes("vision"),
    thinking: lower.includes("thinking"),
  }
}

async function fetchShow(
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<OllamaModelCapabilityEntry> {
  const res = await fetch(`${baseUrl}/api/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, stream: false, verbose: false }),
    signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
  })
  if (!res.ok) {
    return { model, capabilities: [], vision: false, thinking: false }
  }
  const body = (await res.json()) as Record<string, unknown>
  return entryFromShow(model, body)
}

async function getCached(
  redis: Redis | undefined,
  profileId: string,
  model: string,
): Promise<OllamaModelCapabilityEntry | null> {
  const key = cacheKey(profileId, model)
  const mem = memoryCache.get(key)
  if (mem && mem.expiresAt > Date.now()) return mem.entry

  if (redis) {
    try {
      const raw = await redis.get(`${REDIS_PREFIX}${key}`)
      if (raw) {
        const entry = JSON.parse(raw) as OllamaModelCapabilityEntry
        memoryCache.set(key, { expiresAt: Date.now() + MEMORY_TTL_MS, entry })
        return entry
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

async function setCached(
  redis: Redis | undefined,
  profileId: string,
  entry: OllamaModelCapabilityEntry,
): Promise<void> {
  const key = cacheKey(profileId, entry.model)
  memoryCache.set(key, { expiresAt: Date.now() + MEMORY_TTL_MS, entry })
  if (redis) {
    try {
      await redis.set(`${REDIS_PREFIX}${key}`, JSON.stringify(entry), "EX", REDIS_TTL_SEC)
    } catch {
      /* ignore */
    }
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return out
}

/** Whether this Ollama model accepts `think` on /api/chat (from /api/show capabilities). */
export async function ollamaModelSupportsThinking(opts: {
  baseUrl: string
  apiKey: string | null
  model: string
}): Promise<boolean> {
  const model = opts.model.trim()
  if (!model) return false

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`

  const base = opts.baseUrl.replace(/\/$/, "")
  try {
    const entry = await fetchShow(base, headers, model)
    return entry.thinking
  } catch {
    return false
  }
}

export async function resolveOllamaModelCapabilities(opts: {
  profileId: string
  baseUrl: string
  apiKey: string | null
  models: string[]
  redis?: Redis
}): Promise<{ entries: OllamaModelCapabilityEntry[]; fromCache: boolean }> {
  const unique = [...new Set(opts.models.map((m) => m.trim()).filter(Boolean))].slice(0, 80)
  if (unique.length === 0) return { entries: [], fromCache: true }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`

  const base = opts.baseUrl.replace(/\/$/, "")
  let cacheHits = 0

  const entries = await mapPool(unique, SHOW_CONCURRENCY, async (model) => {
    const hit = await getCached(opts.redis, opts.profileId, model)
    if (hit) {
      cacheHits += 1
      return hit
    }
    const entry = await fetchShow(base, headers, model)
    await setCached(opts.redis, opts.profileId, entry)
    return entry
  })

  return {
    entries,
    fromCache: cacheHits === unique.length,
  }
}
