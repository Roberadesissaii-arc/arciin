"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { fetchApi } from "@/lib/api/client"
import { getChatSelection } from "@/lib/api/chat"
import {
  assetChatModelNeed,
  assetChatModeLabel,
  isOllamaChatProfile,
  modelSupportsVision,
  pickModelForAssetFocus,
} from "@/lib/chat/asset-chat-model"
import { getOllamaModelShow } from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"
import { useOllamaAvailableModels } from "@/lib/hooks/use-ollama-available-models"
import type { AssetSummary } from "@/lib/types/models"

export type AssetChatProfile = {
  id: string
  displayName: string
  provider: string
  defaultModel: string | null
  isDefault?: boolean
  isEnabled: boolean
}

export function useAssetChatModel(
  asset: AssetSummary,
  options?: { preferredModel?: string; preferredProfileId?: string },
) {
  const need = assetChatModelNeed(asset)

  const profilesQuery = useQuery({
    queryKey: queryKeys.chatProfiles,
    queryFn: ({ signal }) =>
      fetchApi<AssetChatProfile[]>("/chat/profiles", { signal }),
  })

  const selectionQuery = useQuery({
    queryKey: queryKeys.chatSelection,
    queryFn: ({ signal }) => getChatSelection(signal),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  })

  const selectionProfileId = selectionQuery.data?.profileId
  const selectionModel = selectionQuery.data?.model?.trim() ?? ""

  const profile = useMemo(() => {
    const profiles = profilesQuery.data ?? []
    const selId = options?.preferredProfileId || selectionProfileId
    if (selId) {
      const match = profiles.find((p) => p.id === selId && p.isEnabled !== false)
      if (match) return match
    }
    return (
      profiles.find((p) => p.isDefault && p.isEnabled !== false) ??
      profiles.find((p) => p.isEnabled !== false) ??
      profiles[0] ??
      null
    )
  }, [options?.preferredProfileId, profilesQuery.data, selectionProfileId])

  const profiles = profilesQuery.data ?? []

  const ollama = profile ? isOllamaChatProfile(profile.provider) : false

  const availableQuery = useOllamaAvailableModels(profile?.id ?? "", Boolean(profile && ollama))

  const preferred =
    options?.preferredModel?.trim() ||
    selectionModel ||
    profile?.defaultModel?.trim() ||
    ""

  const explicitModel = options?.preferredModel?.trim() ?? ""

  const modelName = useMemo(
    () =>
      profile
        ? pickModelForAssetFocus({
            available: availableQuery.data?.models ?? [],
            preferred: explicitModel || preferred,
            profileDefault: profile.defaultModel,
            need,
          })
        : "",
    [availableQuery.data?.models, explicitModel, need, preferred, profile],
  )

  /** User pick wins; keep explicit choice even while Ollama tag lists load. */
  const activeModel = (explicitModel || modelName).trim()

  const showQuery = useQuery({
    queryKey: queryKeys.ollamaModelShow(profile?.id ?? "", activeModel),
    queryFn: ({ signal }) =>
      getOllamaModelShow(profile!.id, { model: activeModel }, signal),
    enabled: Boolean(profile && ollama && activeModel),
    staleTime: 60 * 60 * 1000,
  })

  const visionCapable = activeModel
    ? modelSupportsVision(activeModel, showQuery.data ?? null)
    : false

  const ollamaModels = availableQuery.data?.models ?? []
  const profilesLoaded = profilesQuery.data !== undefined
  const modelsLoading =
    (!profilesLoaded && profilesQuery.isLoading) ||
    (Boolean(profile && ollama && !explicitModel) &&
      availableQuery.isLoading &&
      ollamaModels.length === 0)

  const ready = Boolean(profile && activeModel)

  const modeLabel = assetChatModeLabel(need)

  const setupHint = !profile
    ? "Connect a model under Models, then pick one here."
    : !activeModel && !modelsLoading
      ? "Pick a model from the list below."
      : need === "vision" && ollama && activeModel && !visionCapable
        ? `“${activeModel}” may not support images. Choose a vision model (e.g. gemma3, llava).`
        : null

  return {
    profiles,
    profile,
    modelName,
    activeModel,
    selectionModel,
    selectionProfileId,
    need,
    modeLabel,
    visionCapable,
    ready,
    setupHint,
    loading: modelsLoading,
    ollama,
    availableModels: ollamaModels,
    ollamaShow: showQuery.data,
    ollamaShowLoading: showQuery.isFetching && !showQuery.data,
  }
}
