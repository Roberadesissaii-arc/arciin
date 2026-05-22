import { isOllamaProvider, ollamaCapabilitiesIncludeVision } from "@/lib/ollama-providers"
import type { OllamaModelCapabilityEntry, OllamaModelShowData } from "@/lib/types/models"
import type { AssetSummary } from "@/lib/types/models"

export type AssetChatModelNeed = "document" | "vision"

/** Default Ollama tag when Ask AI opens on an image preview. */
export const DEFAULT_IMAGE_VISION_MODEL = "ministral-3:3b"

export function assetChatModelNeed(asset: AssetSummary): AssetChatModelNeed {
  if (asset.mediaType === "IMAGE") return "vision"
  return "document"
}

/** Heuristic when /api/show capabilities are not loaded yet. */
export function modelNameLooksVision(model: string): boolean {
  return /llava|gemma3|gemma4|moondream|minicpm-v|ministral|bakllava|vision|qwen.*vl|llama-3\.2-vision|qwen2\.5vl/i.test(
    model,
  )
}

/** Match an Ollama tag in a list (exact name or `name:variant`). */
export function resolveOllamaModelTag(available: string[], name: string): string | undefined {
  const n = name.trim()
  if (!n) return undefined
  if (available.length === 0) return n
  const exact = available.find((m) => m === n)
  if (exact) return exact
  return available.find((m) => m.startsWith(`${n}:`))
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

  if (need === "vision") {
    const defaultVision = resolveOllamaModelTag(available, DEFAULT_IMAGE_VISION_MODEL)
    if (defaultVision) return defaultVision

    if (preferred) {
      const prefTag = resolveOllamaModelTag(available, preferred) ?? preferred
      if (modelNameLooksVision(prefTag)) return prefTag
    }

    const vision = available.find(modelNameLooksVision)
    if (vision) return vision
    if (preferred) return resolveOllamaModelTag(available, preferred) ?? preferred
    return available[0] ?? ""
  }

  if (preferred) {
    return resolveOllamaModelTag(available, preferred) ?? preferred
  }

  const textFirst = available.find((m) => !modelNameLooksVision(m))
  if (textFirst) return textFirst

  return available[0] ?? ""
}

export function assetChatModeLabel(need: AssetChatModelNeed): string {
  return need === "vision" ? "Vision" : "Document"
}

export function isOllamaChatProfile(provider: string): boolean {
  return isOllamaProvider(provider)
}

export function modelHasVisionCapability(
  model: string,
  cap?: OllamaModelCapabilityEntry | null,
): boolean {
  if (cap) return cap.vision
  return modelNameLooksVision(model)
}

/** For image preview, prefer listing vision-capable Ollama tags. */
export function filterModelsForAssetNeed(
  models: string[],
  need: AssetChatModelNeed,
  capabilityByModel?: Map<string, OllamaModelCapabilityEntry>,
): string[] {
  if (need !== "vision") return models
  const vision = models.filter((m) =>
    modelHasVisionCapability(m, capabilityByModel?.get(m)),
  )
  return vision.length > 0 ? vision : models
}
