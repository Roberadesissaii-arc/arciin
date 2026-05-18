/** Shared HTTP helpers for Ollama local + Ollama Cloud (ollama.com). */

export function ollamaAuthHeaders(apiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const key = apiKey?.trim()
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

export function formatOllamaProviderError(
  status: number,
  bodyText: string,
  opts?: { hasApiKey?: boolean; isCloud?: boolean },
): string {
  if (status === 500 || status === 502 || status === 503) {
    const snippet = bodyText.trim().slice(0, 200)
    return snippet
      ? `Ollama Cloud error (${status}): ${snippet}`
      : `Ollama Cloud error (${status}). Try another model or check ollama.com status.`
  }
  if (status === 401 || status === 403) {
    if (opts?.isCloud || opts?.hasApiKey) {
      return (
        "Ollama Cloud rejected your API key (401). Create or rotate a key at " +
        "https://ollama.com/settings/api-keys and save it under Models → Ollama Cloud."
      )
    }
    return (
      "Ollama returned 401 unauthorized. Cloud models require an API key from " +
      "ollama.com/settings/api-keys."
    )
  }
  const snippet = bodyText.trim().slice(0, 200)
  return snippet ? `Provider error ${status}: ${snippet}` : `Provider error ${status}`
}

export function assertOllamaCloudApiKey(
  provider: string,
  apiKey: string | null | undefined,
): { code: string; message: string } | null {
  if (provider !== "ollama-cloud") return null
  if (apiKey?.trim()) return null
  return {
    code: "OLLAMA_CLOUD_KEY_REQUIRED",
    message:
      "Ollama Cloud requires an API key. Add one from ollama.com/settings/api-keys under Models → Ollama Cloud.",
  }
}

