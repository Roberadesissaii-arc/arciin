/** Static model catalogues for non-Ollama chat providers (mirrors AI Chat picker). */
export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "gpt-4-turbo"],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  grok: ["grok-2", "grok-2-mini", "grok-3"],
  meta: [
    "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  ],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
  ollama: [],
  "ollama-local": [],
  "ollama-cloud": [],
  elevenlabs: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
}
