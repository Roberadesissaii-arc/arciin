const OLLAMA_PROVIDER_IDS = ["ollama", "ollama-local", "ollama-cloud"] as const

export function isOllamaProvider(provider: string): boolean {
  return (OLLAMA_PROVIDER_IDS as readonly string[]).includes(provider)
}

/** Ollama 0.10+ exposes `thinking` in capabilities when the model supports reasoning traces. */
export function ollamaCapabilitiesIncludeThinking(capabilities: string[] | undefined): boolean | null {
  if (!capabilities || capabilities.length === 0) return null
  return capabilities.some((c) => c.toLowerCase() === "thinking")
}

export function ollamaCapabilitiesIncludeVision(capabilities: string[] | undefined): boolean | null {
  if (!capabilities || capabilities.length === 0) return null
  return capabilities.some((c) => c.toLowerCase() === "vision")
}
