import { assertOllamaCloudApiKey } from "@/services/chat/ollama-http"

const OLLAMA_PROVIDERS = new Set(["ollama", "ollama-local", "ollama-cloud"])

function ollamaNativeBase(provider: string, baseUrl: string | null): string {
  const raw = baseUrl ?? (provider === "ollama-cloud" ? "https://ollama.com" : "http://localhost:11434")
  return raw.replace(/\/v1\/?$/, "").replace(/\/$/, "")
}

function pickMatchingOllamaTag(requested: string, tags: string[]): string | null {
  if (tags.length === 0) return null
  const exact = tags.find((t) => t === requested)
  if (exact) return exact
  const prefixed = tags.find(
    (t) => t.startsWith(`${requested}:`) || requested.startsWith(`${t}:`),
  )
  if (prefixed) return prefixed
  const base = requested.split(":")[0]
  return tags.find((t) => t.split(":")[0] === base) ?? null
}

export async function resolveOllamaModelName(input: {
  provider: string
  baseUrl: string | null
  apiKey: string | null
  defaultModel: string | null
  override?: string | null
}): Promise<string> {
  const requested = input.override?.trim() || input.defaultModel?.trim() || ""

  if (!OLLAMA_PROVIDERS.has(input.provider)) {
    return ""
  }

  const cloudKeyError = assertOllamaCloudApiKey(input.provider, input.apiKey)
  if (cloudKeyError) {
    throw new Error(cloudKeyError.message)
  }

  const baseUrl = ollamaNativeBase(input.provider, input.baseUrl)
  const headers: Record<string, string> = {}
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`

  const res = await fetch(`${baseUrl}/api/tags`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(
      `No model selected. Set a default model on this profile under Models (Ollama returned ${res.status}).`,
    )
  }

  const data = (await res.json()) as { models?: { name: string }[] }
  const tags = (data.models ?? []).map((m) => m.name).filter(Boolean)
  if (tags.length === 0) {
    throw new Error("No model selected. Pull a model in Ollama or set a default under Models.")
  }

  if (requested) {
    const matched = pickMatchingOllamaTag(requested, tags)
    if (matched) return matched
    throw new Error(
      `Model "${requested}" is not available on this Ollama instance. Pick another model in AI Chat.`,
    )
  }

  return tags[0]!
}

export async function resolveChatModelName(input: {
  provider: string
  baseUrl: string | null
  apiKey: string | null
  defaultModel: string | null
  override?: string | null
}): Promise<string> {
  const override = input.override?.trim()
  const fallback = input.defaultModel?.trim() || ""

  if (OLLAMA_PROVIDERS.has(input.provider)) {
    return resolveOllamaModelName(input)
  }

  return override || fallback
}
