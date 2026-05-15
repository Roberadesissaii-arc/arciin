/** Shared Ollama vision HTTP helpers for chat services. */

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
): Promise<string> {
  const think: boolean | string = /gpt-oss/i.test(model) ? "low" : false

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think,
      messages: [{ role: "user", content: prompt, images }],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Ollama vision error ${res.status}: ${text.slice(0, 240)}`)
  }

  const json = (await res.json()) as { message?: { content?: string } }
  return json.message?.content?.trim() ?? ""
}
