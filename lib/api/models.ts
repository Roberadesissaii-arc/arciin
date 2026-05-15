import { fetchApi } from "@/lib/api/client"
import type {
  CreateModelProfileInput,
  ModelProfile,
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

export function getAvailableModels(profileId: string, signal?: AbortSignal) {
  return fetchApi<string[]>(`/models/${profileId}/available-models`, { method: "GET", signal })
}

export function getOllamaModelShow(
  profileId: string,
  body: { model: string; verbose?: boolean },
  signal?: AbortSignal,
) {
  return fetchApi<OllamaModelShowData>(`/models/${profileId}/show`, { method: "POST", body, signal })
}
