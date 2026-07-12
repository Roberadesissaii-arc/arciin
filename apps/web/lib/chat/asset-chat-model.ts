import { isOllamaProvider, ollamaCapabilitiesIncludeVision } from "@/lib/ollama-providers"
import { PROVIDER_MODELS } from "@/lib/chat/provider-models"
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
  return /gemini|llava|gemma3|gemma4|moondream|minicpm-v|ministral|bakllava|vision|qwen.*vl|llama-3\.2-vision|qwen2\.5vl|gpt-4o|gpt-4-turbo/i.test(
    model,
  )
}

export function providerIsMultimodal(provider: string, model: string): boolean {
  if (provider === "gemini") return /^gemini-/i.test(model.trim())
  if (provider === "openai") return /gpt-4o|gpt-4-turbo/i.test(model)
  return false
}

/** True when a model tag belongs to the selected cloud provider (not an Ollama tag on Gemini, etc.). */
export function modelBelongsToProvider(provider: string, model: string): boolean {
  const m = model.trim()
  if (!m) return false
  if (isOllamaProvider(provider)) return true
  const catalogue = PROVIDER_MODELS[provider] ?? []
  if (catalogue.includes(m)) return true
  if (provider === "gemini") return /^gemini-/i.test(m)
  if (provider === "openai") return /^(gpt-|o1-?)/i.test(m)
  if (provider === "anthropic") return /^claude-/i.test(m)
  if (provider === "deepseek") return /^deepseek-/i.test(m)
  if (provider === "grok") return /^grok-/i.test(m)
  // Ollama-style tags (colon) must not run on cloud APIs.
  if (m.includes(":")) return false
  return catalogue.some((entry) => entry === m || m.startsWith(`${entry}/`))
}

/** Pick a model that matches the active profile — never send ministral to Gemini. */
export function resolveModelForProfile(input: {
  provider: string
  defaultModel: string | null
  override?: string | null
  need?: AssetChatModelNeed
}): string {
  const override = input.override?.trim() ?? ""
  const fallback = input.defaultModel?.trim() ?? ""
  const catalogue = PROVIDER_MODELS[input.provider] ?? []

  if (isOllamaProvider(input.provider)) {
    return override || fallback
  }

  if (override && modelBelongsToProvider(input.provider, override)) {
    return override
  }

  if (fallback && modelBelongsToProvider(input.provider, fallback)) {
    return fallback
  }

  if (input.need === "vision") {
    const vision = catalogue.find((m) => providerIsMultimodal(input.provider, m))
    if (vision) return vision
  }

  return catalogue[0] ?? fallback ?? override
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
  provider?: string,
): boolean {
  if (provider === "gemini" && /^gemini-/i.test(model.trim())) return true
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
