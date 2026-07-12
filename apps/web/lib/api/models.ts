import { fetchApi } from "@/lib/api/client"
import type {
  CreateModelProfileInput,
  ModelProfile,
  OllamaAvailableModelsResult,
  OllamaCloudModelsResult,
  OllamaModelCapabilitiesResult,
  OllamaModelShowData,
  UpdateModelProfileInput,
} from "@/lib/types/models"

export function getModelProfiles(signal?: AbortSignal) {
  return fetchApi<ModelProfile[]>("/models", { method: "GET", signal })
}

export function createModelProfile(input: CreateModelProfileInput) {
  return fetchApi<ModelProfile>("/models", { method: "POST", body: input })
}

export function updateModelProfile(id: string, input: UpdateModelProfileInput) {
  return fetchApi<ModelProfile>(`/models/${id}`, { method: "PATCH", body: input })
}

export function deleteModelProfile(id: string) {
  return fetchApi<{ success: true }>(`/models/${id}`, { method: "DELETE" })
}

export function setDefaultModelProfile(id: string) {
  return fetchApi<ModelProfile>(`/models/${id}/set-default`, { method: "POST", body: {} })
}

export type ModelTestResult = { model: string; reply: string }

/** Free-tier Ollama connection test — one short prompt, one short reply. */
export function testModelProfile(id: string, input?: { prompt?: string; model?: string }) {
  return fetchApi<ModelTestResult>(`/models/${id}/test`, {
    method: "POST",
    body: input ?? {},
  })
}

export function getAvailableModels(
  profileId: string,
  opts?: { refresh?: boolean; signal?: AbortSignal },
) {
  const qs = opts?.refresh ? "?refresh=1" : ""
  return fetchApi<OllamaAvailableModelsResult>(`/models/${profileId}/available-models${qs}`, {
    method: "GET",
    signal: opts?.signal,
  })
}

export function getOllamaCloudModels(
  profileId: string,
  opts?: { refresh?: boolean; signal?: AbortSignal },
) {
  const qs = opts?.refresh ? "?refresh=1" : ""
  return fetchApi<OllamaCloudModelsResult>(`/models/${profileId}/cloud-models${qs}`, {
    method: "GET",
    signal: opts?.signal,
  })
}

export function getOllamaModelShow(
  profileId: string,
  body: { model: string; verbose?: boolean },
  signal?: AbortSignal,
) {
  return fetchApi<OllamaModelShowData>(`/models/${profileId}/show`, { method: "POST", body, signal })
}

/** Batch Ollama /api/show — vision / thinking per model tag (cached server-side). */
export function getOllamaModelCapabilities(
  profileId: string,
  body: { models: string[] },
  signal?: AbortSignal,
) {
  return fetchApi<OllamaModelCapabilitiesResult>(`/models/${profileId}/model-capabilities`, {
    method: "POST",
    body,
    signal,
  })
}
