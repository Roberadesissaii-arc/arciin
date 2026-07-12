"use client"

import type { ComponentType } from "react"
import {
  Anthropic,
  Claude,
  Cohere,
  DeepSeek,
  ElevenLabs,
  Gemini,
  Grok,
  HuggingFace,
  Meta,
  Midjourney,
  Mistral,
  Ollama,
  OpenAI,
  Perplexity,
  Qwen,
  Stability,
  XAI,
  Vercel,
} from "@lobehub/icons"

import type { VaultBrandMatch } from "@/lib/passwords/vault-brand"
import { cn } from "@/lib/utils"

const LOBEHUB_ICONS: Record<string, ComponentType<{ size?: number | string; className?: string }>> = {
  openai: OpenAI,
  anthropic: Anthropic,
  claude: Claude,
  gemini: Gemini,
  google: Gemini,
  meta: Meta,
  ollama: Ollama,
  mistral: Mistral,
  deepseek: DeepSeek,
  qwen: Qwen,
  grok: Grok,
  elevenlabs: ElevenLabs,
  perplexity: Perplexity,
  cohere: Cohere,
  huggingface: HuggingFace,
  stability: Stability,
  midjourney: Midjourney,
  xai: XAI,
  vercel: Vercel,
}

export function VaultLobeHubModelIcon({
  match,
  size = 28,
  className,
}: {
  match: VaultBrandMatch
  size?: number
  className?: string
}) {
  const Icon = LOBEHUB_ICONS[match.key]
  if (!Icon) return null
  return <Icon size={size} className={cn("shrink-0", className)} />
}
