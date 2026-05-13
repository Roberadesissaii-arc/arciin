import { fetchApi } from "@/lib/api/client"
import type {
  ApiKeySummary,
  CreateApiKeyInput,
  CreateApiKeyResult,
  IntegrationSummary,
  JobSummary,
  RemoteAccessSettings,
  StorageSettings,
} from "@/lib/types/models"

export function getStorageSettings(signal?: AbortSignal) {
  return fetchApi<StorageSettings>("/settings/storage", {
    method: "GET",
    signal,
  })
}

export function updateStorageSettings(storageRoot: string) {
  return fetchApi<StorageSettings>("/settings/storage", {
    method: "PATCH",
    body: {
      storageRoot,
    },
  })
}

export function getRemoteAccessSettings(signal?: AbortSignal) {
  return fetchApi<RemoteAccessSettings>("/settings/remote-access", {
    method: "GET",
    signal,
  })
}

export function updateRemoteAccessSettings(input: Partial<RemoteAccessSettings>) {
  return fetchApi<RemoteAccessSettings>("/settings/remote-access", {
    method: "PATCH",
    body: input,
  })
}

export function getJobs(signal?: AbortSignal) {
  return fetchApi<JobSummary[]>("/jobs", {
    method: "GET",
    signal,
  })
}

export function getApiKeys(signal?: AbortSignal) {
  return fetchApi<ApiKeySummary[]>("/api-keys", {
    method: "GET",
    signal,
  })
}

export function createApiKey(input: CreateApiKeyInput) {
  return fetchApi<CreateApiKeyResult>("/api-keys", {
    method: "POST",
    body: input,
  })
}

export function revokeApiKey(id: string) {
  return fetchApi<{ success: true }>(`/api-keys/${id}`, {
    method: "DELETE",
  })
}

export function rotateApiKey(id: string) {
  return fetchApi<CreateApiKeyResult>(`/api-keys/${id}/rotate`, {
    method: "POST",
    body: {},
  })
}

export function getIntegrations(signal?: AbortSignal) {
  return fetchApi<IntegrationSummary[]>("/integrations", {
    method: "GET",
    signal,
  })
}
