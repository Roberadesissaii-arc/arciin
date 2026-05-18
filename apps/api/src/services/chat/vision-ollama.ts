/** Shared Ollama vision HTTP helpers for chat services. */

import { normalizeOllamaCloudModelId } from "@/services/chat/ollama-cloud-models"
import { formatOllamaProviderError, ollamaAuthHeaders } from "@/services/chat/ollama-http"

export function parseVisionJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  const m = trimmed.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function ollamaVisionChat(
  baseUrl: string,
  model: string,
  prompt: string,
  images: string[],
  apiKey?: string | null,
): Promise<string> {
  const isCloud = baseUrl.includes("ollama.com")
  const apiModel = isCloud ? normalizeOllamaCloudModelId(model) : model
  const think: boolean | string = /gpt-oss/i.test(apiModel) ? "low" : false

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: ollamaAuthHeaders(apiKey),
    body: JSON.stringify({
      model: apiModel,
      stream: false,
      think,
      messages: [{ role: "user", content: prompt, images }],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(
      formatOllamaProviderError(res.status, text, {
        hasApiKey: Boolean(apiKey?.trim()),
        isCloud,
      }),
    )
  }

  const json = (await res.json()) as { message?: { content?: string } }
  return json.message?.content?.trim() ?? ""
}
