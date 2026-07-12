/** Default chat model when connecting Google Gemini. */
export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-2.5-flash"

/** Default read-aloud model (Gemini Interactions API TTS). Uses the same API key as chat. */
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts"

export type GeminiModelKind = "chat" | "tts" | "other"

export type GeminiModelEntry = {
  id: string
  label: string
  kind: GeminiModelKind
  badge?: "Stable" | "Preview" | "Deprecated"
}

/** Chat / text generation models for Arciin. */
export const GEMINI_CHAT_MODELS: GeminiModelEntry[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", kind: "chat", badge: "Stable" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", kind: "chat", badge: "Stable" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", kind: "chat", badge: "Stable" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", kind: "chat", badge: "Stable" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", kind: "chat", badge: "Stable" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", kind: "chat", badge: "Preview" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", kind: "chat", badge: "Preview" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", kind: "chat", badge: "Deprecated" },
]

/** Text-to-speech models (Interactions API). Same Google AI Studio key as chat. */
export const GEMINI_TTS_MODELS: GeminiModelEntry[] = [
  {
    id: "gemini-2.5-flash-preview-tts",
    label: "Gemini 2.5 Flash TTS",
    kind: "tts",
    badge: "Preview",
  },
  {
    id: "gemini-3.1-flash-tts-preview",
    label: "Gemini 3.1 Flash TTS",
    kind: "tts",
    badge: "Preview",
  },
  {
    id: "gemini-2.5-pro-preview-tts",
    label: "Gemini 2.5 Pro TTS",
    kind: "tts",
    badge: "Preview",
  },
]

/** Other Gemini models (listed for reference; not used by Arciin yet). */
export const GEMINI_OTHER_MODELS: GeminiModelEntry[] = [
  { id: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live", kind: "other", badge: "Preview" },
  { id: "gemini-2.5-flash-live-preview", label: "Gemini 2.5 Flash Live", kind: "other", badge: "Preview" },
  { id: "gemini-embedding-001", label: "Gemini Embedding", kind: "other", badge: "Stable" },
]

export const GEMINI_CHAT_MODEL_IDS = GEMINI_CHAT_MODELS.map((m) => m.id)
export const GEMINI_TTS_MODEL_IDS = GEMINI_TTS_MODELS.map((m) => m.id)

export function isGeminiTtsModelId(modelId: string | null | undefined): boolean {
  if (!modelId) return false
  return GEMINI_TTS_MODEL_IDS.includes(modelId) || /-tts/i.test(modelId)
}
