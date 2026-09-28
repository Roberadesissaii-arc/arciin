import { fetchApi } from "@/lib/api/client"

export type SemanticSearchStatus = {
  enabled: boolean
  indexingActive: boolean
  provider: string
  embeddingModel: string
  model: {
    state: "installed" | "missing" | "ollama_offline" | "not_local"
    sizeBytes: number | null
    dimension: number | null
    digest: string | null
  }
  captionModel: string | null
  index: {
    state: "off" | "not_indexed" | "indexing" | "paused" | "ready"
    eligible: number
    indexed: number
    pending: number
    failed: number
    skipped: number
  }
  install: { state: "running" | "done" | "failed"; completed: number | null; total: number | null } | null
}

export function getSemanticSearchStatus(signal?: AbortSignal) {
  return fetchApi<SemanticSearchStatus>("/semantic-search/status", { signal })
}
export function setSemanticSearchEnabled(enabled: boolean) {
  return fetchApi<SemanticSearchStatus>("/semantic-search/settings", { method: "PATCH", body: { enabled } })
}
export function startSemanticIndexing() {
  return fetchApi<SemanticSearchStatus>("/semantic-search/index", { method: "POST" })
}
export function pauseSemanticIndexing() {
  return fetchApi<SemanticSearchStatus>("/semantic-search/pause", { method: "POST" })
}
export function rebuildSemanticIndex() {
  return fetchApi<SemanticSearchStatus>("/semantic-search/rebuild", { method: "POST" })
}
/** Explicit owner action: installs the embedding model into the local Ollama. */
export function installSemanticModel() {
  return fetchApi<SemanticSearchStatus>("/semantic-search/model/install", { method: "POST", body: { confirm: true } })
}
