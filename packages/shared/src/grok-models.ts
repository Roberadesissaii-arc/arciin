/**
 * xAI (Grok) chat / code models.
 *
 * Arciin only uses xAI for text chat. The image, video, and voice models on the
 * xAI catalogue (Grok Imagine, Grok Voice, TTS/STT) are deliberately absent —
 * nothing in the app can drive them yet, and listing them would only offer the
 * user a model id that fails at request time.
 *
 * xAI serves an OpenAI-compatible API, so these ids go straight into the normal
 * /chat/completions path. The authoritative list lives on the provider: once a
 * key is saved, the Models page fetches GET /v1/models and shows what the key
 * actually has access to. This catalogue is the offline fallback and the source
 * of the human-readable labels; the ids below were verified against that live
 * catalogue.
 */

/** Default chat model when connecting xAI. */
export const DEFAULT_GROK_CHAT_MODEL = "grok-4.5"

export type GrokModelEntry = {
  id: string
  label: string
  /** Context window, already formatted for display. */
  context: string
  description: string
  badge?: "New" | "Stable" | "Beta"
  /** Supports tool calling — required for Arciin's chat tools. */
  tools: boolean
  reasoning: boolean
  vision: boolean
}

export const GROK_CHAT_MODELS: GrokModelEntry[] = [
  {
    id: "grok-4.5",
    label: "Grok 4.5",
    context: "500K",
    description: "Intelligent coding model for agentic software, engineering, and workflow tasks.",
    badge: "New",
    tools: true,
    reasoning: true,
    vision: true,
  },
  {
    id: "grok-4.3",
    label: "Grok 4.3",
    context: "1M",
    description: "Most advanced model with best-in-class accuracy and instruction following.",
    badge: "Stable",
    tools: true,
    reasoning: true,
    vision: true,
  },
  {
    id: "grok-4.20-0309-reasoning",
    label: "Grok 4.20",
    context: "1M",
    description: "High-speed reasoning with industry-leading agentic tool calling.",
    badge: "Stable",
    tools: true,
    reasoning: true,
    vision: true,
  },
  {
    id: "grok-4.20-0309-non-reasoning",
    label: "Grok 4.20 (Non-Reasoning)",
    context: "1M",
    description: "Fast, cost-efficient responses powered by the flagship architecture.",
    badge: "Stable",
    tools: true,
    reasoning: false,
    vision: true,
  },
  {
    id: "grok-4.20-multi-agent-0309",
    label: "Grok 4.20 Multi-Agent",
    context: "1M",
    description: "Multiple agents collaborate in parallel to perform deep research tasks.",
    badge: "Beta",
    tools: true,
    reasoning: true,
    vision: true,
  },
  {
    id: "grok-build-0.1",
    label: "Grok Build 0.1",
    context: "256K",
    description: "Fast coding model for agentic coding workflows.",
    badge: "Stable",
    tools: true,
    reasoning: true,
    vision: true,
  },
]

export const GROK_CHAT_MODEL_IDS = GROK_CHAT_MODELS.map((m) => m.id)

/**
 * Model ids on the xAI catalogue that Arciin cannot use.
 *
 * GET /v1/models returns every model the key can reach, including the image,
 * video, and voice families. Sending one of those to /chat/completions fails,
 * so they are filtered out of the picker rather than offered and left to break.
 */
const NON_CHAT_PATTERNS = [
  /imagine/i,
  /image/i,
  /video/i,
  /voice/i,
  /\btts\b/i,
  /text-to-speech/i,
  /speech/i,
  /transcri/i,
  /embed/i,
]

/** True when a model id from the xAI catalogue can be used for chat. */
export function isGrokChatModelId(modelId: string | null | undefined): boolean {
  const id = modelId?.trim()
  if (!id) return false
  if (GROK_CHAT_MODEL_IDS.includes(id)) return true
  return !NON_CHAT_PATTERNS.some((re) => re.test(id))
}

/** Human label for a model id — falls back to the raw id for unknown models. */
export function grokModelLabel(modelId: string): string {
  return GROK_CHAT_MODELS.find((m) => m.id === modelId)?.label ?? modelId
}
