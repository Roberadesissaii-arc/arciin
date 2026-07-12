"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { getOllamaModelCapabilities } from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"
import type { OllamaModelCapabilityEntry } from "@/lib/types/models"

export const OLLAMA_CAPABILITIES_STALE_MS = 24 * 60 * 60_000
export const OLLAMA_CAPABILITIES_GC_MS = 48 * 60 * 60_000

function modelsCacheKey(models: string[]): string {
  return [...models].sort().join("\0")
}

export function ollamaCapabilityMap(
  entries: OllamaModelCapabilityEntry[] | undefined,
): Map<string, OllamaModelCapabilityEntry> {
  const map = new Map<string, OllamaModelCapabilityEntry>()
  for (const e of entries ?? []) {
    map.set(e.model, e)
  }
  return map
}

export function useOllamaModelCapabilities(
  profileId: string,
  models: string[],
  enabled = true,
) {
  const modelsKey = useMemo(() => modelsCacheKey(models), [models])

  return useQuery({
    queryKey: queryKeys.ollamaModelCapabilities(profileId, modelsKey),
    queryFn: ({ signal }) =>
      getOllamaModelCapabilities(profileId, { models }, signal),
    enabled: enabled && Boolean(profileId) && models.length > 0,
    staleTime: OLLAMA_CAPABILITIES_STALE_MS,
    gcTime: OLLAMA_CAPABILITIES_GC_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
