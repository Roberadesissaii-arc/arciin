import type Redis from "ioredis"

import { formatOllamaProviderError, ollamaAuthHeaders } from "@/services/chat/ollama-http"

export type OllamaCloudModelAccess = "available" | "paid" | "rate_limited" | "error"

export type OllamaCloudModelProbe = {
  name: string
  access: OllamaCloudModelAccess
  message?: string
}

export type OllamaCloudProbeResult = {
  probes: OllamaCloudModelProbe[]
  fromCache: boolean
}

type CacheEntry = {
  expiresAt: number
  results: OllamaCloudModelProbe[]
}

const probeCache = new Map<string, CacheEntry>()
const MEMORY_CACHE_TTL_MS = 15 * 60_000
const REDIS_KEY_PREFIX = "arciin:ollama-cloud:v1:"
const REDIS_TTL_SEC = 7 * 24 * 60 * 60
const PROBE_CONCURRENCY = 8
const PROBE_TIMEOUT_MS = 12_000

/** Models that must appear when the API catalog uses a different id (e.g. gpt-oss:120b vs gpt-oss:120b-cloud). */
const EXTRA_API_MODELS = ["gpt-oss:120b"]

function cacheKey(profileId: string, apiKey: string): string {
  return `${profileId}:${apiKey.slice(0, 8)}:${apiKey.length}`
}

/** Map UI / CLI names to ollama.com API model ids. */
export function normalizeOllamaCloudModelId(model: string): string {
  const m = model.trim()
  if (m.endsWith("-cloud")) return m.slice(0, -6)
  if (m.endsWith(":cloud")) return m.slice(0, -6)
  return m
}

/** Extra display ids (e.g. gpt-oss:120b-cloud) when the API id works. */
export function cloudDisplayAliases(apiModel: string): string[] {
  const out = new Set<string>([apiModel])
  if (!apiModel.endsWith("-cloud") && !apiModel.endsWith(":cloud")) {
    out.add(`${apiModel}-cloud`)
  }
  return [...out]
}

export async function fetchOllamaCloudTagNames(baseUrl: string): Promise<string[]> {
  const host = baseUrl.replace(/\/$/, "")
  const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Ollama returned ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`)
  }
  const data = (await res.json()) as { models?: { name: string }[] }
  const names = (data.models ?? []).map((m) => m.name).filter(Boolean)
  const apiIds = new Set<string>()
  for (const n of names) apiIds.add(normalizeOllamaCloudModelId(n))
  for (const extra of EXTRA_API_MODELS) apiIds.add(extra)
  return [...apiIds]
}

function classifyProbeFailure(status: number, bodyText: string): {
  access: OllamaCloudModelAccess
  message: string
} {
  const lower = bodyText.toLowerCase()
  if (status === 429 || lower.includes("rate limit") || lower.includes("quota")) {
    return {
      access: "rate_limited",
      message: bodyText.trim().slice(0, 200) || "Rate limited — try again later.",
    }
  }
  if (status === 401 || status === 403 || status === 402) {
    return {
      access: "paid",
      message:
        status === 401 || status === 403
          ? "Requires a paid API key or different entitlement on ollama.com."
          : bodyText.trim().slice(0, 200) || "Paid tier required.",
    }
  }
  return {
    access: "error",
    message: bodyText.trim().slice(0, 200) || `Request failed (${status})`,
  }
}

export async function probeOllamaCloudModel(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<OllamaCloudModelProbe> {
  const apiModel = normalizeOllamaCloudModelId(model)
  const host = baseUrl.replace(/\/$/, "")
  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: ollamaAuthHeaders(apiKey),
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        stream: false,
        options: { num_predict: 1 },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    if (res.ok) {
      return { name: apiModel, access: "available" }
    }

    const text = await res.text().catch(() => "")
    const { access, message } = classifyProbeFailure(res.status, text)
    return { name: apiModel, access, message }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Probe failed"
    return { name: apiModel, access: "error", message: msg }
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0

  async function worker() {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i]!)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}

async function loadRedisCache(
  redis: Redis,
  ck: string,
): Promise<OllamaCloudModelProbe[] | null> {
  try {
    const raw = await redis.get(`${REDIS_KEY_PREFIX}${ck}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OllamaCloudModelProbe[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function saveRedisCache(redis: Redis, ck: string, results: OllamaCloudModelProbe[]) {
  try {
    await redis.set(`${REDIS_KEY_PREFIX}${ck}`, JSON.stringify(results), "EX", REDIS_TTL_SEC)
  } catch {
    /* non-fatal */
  }
}

function sortProbes(results: OllamaCloudModelProbe[]): OllamaCloudModelProbe[] {
  const order: Record<OllamaCloudModelAccess, number> = {
    available: 0,
    rate_limited: 1,
    paid: 2,
    error: 3,
  }
  return [...results].sort(
    (a, b) => order[a.access] - order[b.access] || a.name.localeCompare(b.name),
  )
}

function rememberCache(ck: string, results: OllamaCloudModelProbe[]) {
  probeCache.set(ck, { results, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS })
}

/** Probe ollama.com once per profile/key; reuse Redis + memory cache on later opens. */
export async function probeOllamaCloudModels(opts: {
  profileId: string
  baseUrl: string
  apiKey: string
  refresh?: boolean
  redis?: Redis
}): Promise<OllamaCloudProbeResult> {
  const key = opts.apiKey.trim()
  const ck = cacheKey(opts.profileId, key)

  if (!opts.refresh) {
    const mem = probeCache.get(ck)
    if (mem && mem.expiresAt > Date.now()) {
      return { probes: mem.results, fromCache: true }
    }
    if (opts.redis) {
      const redisCached = await loadRedisCache(opts.redis, ck)
      if (redisCached?.length) {
        const sorted = sortProbes(redisCached)
        rememberCache(ck, sorted)
        return { probes: sorted, fromCache: true }
      }
    }
  }

  const names = await fetchOllamaCloudTagNames(opts.baseUrl)
  if (names.length === 0) {
    return { probes: [], fromCache: false }
  }

  const results = await mapPool(names, PROBE_CONCURRENCY, (name) =>
    probeOllamaCloudModel(opts.baseUrl, key, name),
  )

  const sorted = sortProbes(results)
  rememberCache(ck, sorted)
  if (opts.redis) {
    await saveRedisCache(opts.redis, ck, sorted)
  }

  return { probes: sorted, fromCache: false }
}

export function availableCloudModelNames(probes: OllamaCloudModelProbe[]): string[] {
  const names = new Set<string>()
  for (const p of probes) {
    if (p.access !== "available") continue
    for (const alias of cloudDisplayAliases(p.name)) {
      names.add(alias)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export async function assertOllamaCloudKeyWorks(
  baseUrl: string,
  apiKey: string,
  preferredModel?: string | null,
): Promise<void> {
  const key = apiKey.trim()
  let model = preferredModel?.trim()
  if (!model) {
    const names = await fetchOllamaCloudTagNames(baseUrl)
    model = names[0]
  }
  if (!model) {
    throw new Error("No models returned from ollama.com.")
  }

  const probe = await probeOllamaCloudModel(baseUrl, key, model)
  if (probe.access === "available") return

  if (probe.access === "paid") {
    throw new Error(
      formatOllamaProviderError(401, probe.message ?? "", { hasApiKey: true, isCloud: true }),
    )
  }
  throw new Error(probe.message ?? "Could not verify Ollama Cloud API key.")
}

export async function invalidateOllamaCloudProbeCache(
  profileId: string,
  redis?: Redis,
): Promise<void> {
  for (const k of probeCache.keys()) {
    if (k.startsWith(`${profileId}:`)) probeCache.delete(k)
  }
  if (!redis) return
  try {
    const keys = await redis.keys(`${REDIS_KEY_PREFIX}${profileId}:*`)
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    /* non-fatal */
  }
}
