/**
 * How the orchestrator actually reaches a model.
 *
 * A deliberately thin transport: one chapter request, one streamed response,
 * no conversation history. The chapter prompt already carries everything the
 * model needs — brief, outline, memory, contract, tail — so sending the chat
 * history as well would resend the manuscript by the back door and undo the
 * whole point of the memory layer.
 *
 * Separate from the composer's send path because the two want different things.
 * A chat turn belongs in the transcript, updates a message bubble and appends
 * to history. A chapter belongs in the manuscript and nowhere else.
 */

import { getChatStreamPostUrl } from "@/lib/api/chat"

import type { ChapterGenerator } from "./book-orchestrator"
import type { BookTransportConfig } from "./book-transport"

export type ChapterGeneratorConfig = BookTransportConfig

export function createChapterGenerator(
  getConfig: () => ChapterGeneratorConfig | null,
): ChapterGenerator {
  return async function generateChapter(request) {
    const config = getConfig()
    if (!config?.profileId) {
      return { ok: false, error: "No model is selected." }
    }

    let response: Response
    try {
      response = await fetch(getChatStreamPostUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          profileId: config.profileId,
          ...(config.model ? { model: config.model } : {}),
          // Tells the API this turn produces a document, so it withholds the
          // tools that would otherwise try to file it somewhere.
          canvas: true,
          messages: [
            ...(config.systemPrompt?.trim()
              ? [{ role: "system", content: config.systemPrompt.trim() }]
              : []),
            { role: "user", content: request.prompt },
          ],
        }),
        signal: request.signal,
      })
    } catch (error) {
      if (request.signal.aborted) return { ok: false, error: "Cancelled." }
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not reach the model.",
      }
    }

    if (!response.ok || !response.body) {
      return { ok: false, error: `The model service returned HTTP ${response.status}.` }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let text = ""

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        if (done) buffer += decoder.decode()

        const lines = buffer.split("\n")
        buffer = done ? "" : (lines.pop() ?? "")

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === "[DONE]") continue

          try {
            const json = JSON.parse(payload) as { error?: string; text?: string }
            if (json.error) return { ok: false, error: json.error }
            if (json.text) {
              text += json.text
              request.onToken(text)
            }
          } catch {
            // A partial frame is normal mid-stream; the next read completes it.
          }
        }

        if (done) break
      }
    } catch (error) {
      if (request.signal.aborted) return { ok: false, error: "Cancelled." }
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The stream ended early.",
      }
    }

    if (!text.trim()) return { ok: false, error: "The model returned nothing." }
    return { ok: true, raw: text }
  }
}
