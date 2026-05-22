import { isOllamaProvider, ollamaCapabilitiesIncludeVision } from "@/lib/ollama-providers"
import type { OllamaModelShowData } from "@/lib/types/models"
import type { AssetSummary } from "@/lib/types/models"

export type AssetChatModelNeed = "document" | "vision"

export function assetChatModelNeed(asset: AssetSummary): AssetChatModelNeed {
  if (asset.mediaType === "IMAGE") return "vision"
  return "document"
}

/** Heuristic when /api/show capabilities are not loaded yet. */
export function modelNameLooksVision(model: string): boolean {
  return /llava|gemma3|gemma4|moondream|minicpm-v|bakllava|vision|qwen.*vl|llama-3\.2-vision|qwen2\.5vl/i.test(
    model,
  )
}

export function modelSupportsVision(
  model: string,
  show?: OllamaModelShowData | null,
): boolean {
  const fromShow = ollamaCapabilitiesIncludeVision(show?.capabilities)
  if (fromShow === true) return true
  if (fromShow === false) return false
  return modelNameLooksVision(model)
}

export function pickModelForAssetFocus(input: {
  available: string[]
  preferred: string
  profileDefault: string | null
  need: AssetChatModelNeed
}): string {
  const { available, need } = input
  const preferred = input.preferred.trim() || input.profileDefault?.trim() || ""

  const inList = (name: string) =>
    available.length === 0 || available.some((m) => m === name || m.startsWith(`${name}:`))

  if (preferred && (available.length === 0 || inList(preferred))) {
    if (need === "vision") {
      if (modelNameLooksVision(preferred)) return preferred
    } else {
      return preferred
    }
  }

  if (need === "vision") {
    const vision = available.find(modelNameLooksVision)
    if (vision) return vision
    if (preferred) return preferred
  }

  if (need === "document") {
    if (preferred) return preferred
    const textFirst = available.find((m) => !modelNameLooksVision(m))
    if (textFirst) return textFirst
  }

  return available[0] ?? preferred
}

export function assetChatModeLabel(need: AssetChatModelNeed): string {
  return need === "vision" ? "Vision" : "Document"
}

export function isOllamaChatProfile(provider: string): boolean {
  return isOllamaProvider(provider)
}

/** For image preview, prefer listing vision-capable Ollama tags. */
export function filterModelsForAssetNeed(
  models: string[],
  need: AssetChatModelNeed,
): string[] {
  if (need !== "vision") return models
  const vision = models.filter(modelNameLooksVision)
  return vision.length > 0 ? vision : models
}
