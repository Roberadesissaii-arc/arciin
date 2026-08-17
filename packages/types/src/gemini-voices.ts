/**
 * The provider's prebuilt voices.
 *
 * In the shared types package rather than beside the synthesis code because the
 * browser needs it too: an advanced voice picker has to list real voices, and a
 * second hand-maintained copy in the UI would drift from the one the server
 * actually uses.
 */
/** Gemini's prebuilt voices, with the character each one reads as. */
export const GEMINI_VOICES = [
  { name: "Zephyr", character: "Bright", pitch: "high", energy: "high", texture: "bright" },
  { name: "Puck", character: "Upbeat", pitch: "medium", energy: "high", texture: "clear" },
  { name: "Charon", character: "Informative", pitch: "low", energy: "medium", texture: "clear" },
  { name: "Kore", character: "Firm", pitch: "medium", energy: "medium", texture: "firm" },
  { name: "Fenrir", character: "Excitable", pitch: "medium", energy: "high", texture: "bright" },
  { name: "Leda", character: "Youthful", pitch: "high", energy: "high", texture: "clear" },
  { name: "Orus", character: "Firm", pitch: "low", energy: "medium", texture: "firm" },
  { name: "Aoede", character: "Breezy", pitch: "medium", energy: "medium", texture: "smooth" },
  { name: "Callirrhoe", character: "Easy-going", pitch: "medium", energy: "low", texture: "smooth" },
  { name: "Autonoe", character: "Bright", pitch: "high", energy: "high", texture: "bright" },
  { name: "Enceladus", character: "Breathy", pitch: "low", energy: "low", texture: "breathy" },
  { name: "Iapetus", character: "Clear", pitch: "medium", energy: "medium", texture: "clear" },
  { name: "Umbriel", character: "Easy-going", pitch: "low", energy: "low", texture: "smooth" },
  { name: "Algieba", character: "Smooth", pitch: "low", energy: "medium", texture: "smooth" },
  { name: "Despina", character: "Smooth", pitch: "medium", energy: "medium", texture: "smooth" },
  { name: "Erinome", character: "Clear", pitch: "medium", energy: "medium", texture: "clear" },
  { name: "Algenib", character: "Gravelly", pitch: "low", energy: "medium", texture: "gravelly" },
  { name: "Rasalgethi", character: "Informative", pitch: "medium", energy: "medium", texture: "clear" },
  { name: "Laomedeia", character: "Upbeat", pitch: "high", energy: "high", texture: "bright" },
  { name: "Achernar", character: "Soft", pitch: "high", energy: "low", texture: "soft" },
  { name: "Alnilam", character: "Firm", pitch: "medium", energy: "medium", texture: "firm" },
  { name: "Schedar", character: "Even", pitch: "medium", energy: "medium", texture: "clear" },
  { name: "Gacrux", character: "Mature", pitch: "low", energy: "medium", texture: "warm" },
  { name: "Pulcherrima", character: "Forward", pitch: "medium", energy: "high", texture: "firm" },
  { name: "Achird", character: "Friendly", pitch: "medium", energy: "medium", texture: "warm" },
  { name: "Zubenelgenubi", character: "Casual", pitch: "medium", energy: "medium", texture: "clear" },
  { name: "Vindemiatrix", character: "Gentle", pitch: "high", energy: "low", texture: "soft" },
  { name: "Sadachbia", character: "Lively", pitch: "medium", energy: "high", texture: "bright" },
  { name: "Sadaltager", character: "Knowledgeable", pitch: "medium", energy: "medium", texture: "clear" },
  { name: "Sulafat", character: "Warm", pitch: "medium", energy: "medium", texture: "warm" },
] as const

export type GeminiVoiceName = (typeof GEMINI_VOICES)[number]["name"]

/** A safe default when analysis is inconclusive: even, unremarkable, clear. */
export const NEUTRAL_VOICE: GeminiVoiceName = "Schedar"
