import { GROK_CHAT_MODEL_IDS } from "@arciin/shared"

/** Static model catalogues for non-Ollama chat providers (mirrors AI Chat picker). */
export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "gpt-4-turbo"],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  gemini: [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
  ],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  grok: [...GROK_CHAT_MODEL_IDS],
  meta: [
    "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  ],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
  ollama: [],
  "ollama-local": [],
  "ollama-cloud": [
    "gpt-oss:120b",
    "deepseek-v4-flash",
    "qwen3.5",
    "gemma4:31b",
    "kimi-k2.6",
    "minimax-m3",
  ],
  elevenlabs: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
}
