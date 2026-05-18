"use client"

import { useQuery, type QueryClient } from "@tanstack/react-query"

import { getAvailableModels } from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"

export const OLLAMA_MODELS_STALE_MS = 10 * 60_000
export const OLLAMA_MODELS_GC_MS = 30 * 60_000

const ollamaModelsQueryOptions = (profileId: string) => ({
  queryKey: queryKeys.availableModels(profileId),
  queryFn: ({ signal }: { signal?: AbortSignal }) => getAvailableModels(profileId, signal),
  staleTime: OLLAMA_MODELS_STALE_MS,
  gcTime: OLLAMA_MODELS_GC_MS,
  retry: 1,
  retryDelay: 1500,
  refetchOnWindowFocus: false,
})

export function useOllamaAvailableModels(profileId: string, enabled = true) {
  return useQuery({
    ...ollamaModelsQueryOptions(profileId),
    enabled: enabled && Boolean(profileId),
    placeholderData: (previous) => previous,
  })
}

export function prefetchOllamaAvailableModels(queryClient: QueryClient, profileId: string) {
  return queryClient.prefetchQuery(ollamaModelsQueryOptions(profileId))
}
