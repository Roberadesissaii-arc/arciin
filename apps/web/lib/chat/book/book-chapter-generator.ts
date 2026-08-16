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

/**
 * How long a single chapter may take before the browser gives up on it.
 *
 * Deliberately *above* the provider's own ceiling — `ollama-chat-with-tools`
 * aborts its upstream call at 600 seconds — so a normal slow chapter is always
 * ended by the provider with a real error, and this only ever fires when
 * something upstream has stopped answering altogether. Setting it below 600
 * would make the browser the thing that kills legitimate long reasoning.
 *
 * Why it needs to exist at all: the orchestrator's single-flight lock is held
 * for the whole of `generator(...)`. A fetch that never settles holds it
 * forever, and the book does not fail, does not retry, and does not report
 * anything — it simply stops, with the card still saying it is writing.
 */
export const CHAPTER_WATCHDOG_MS = 660_000

/** Distinguishes a watchdog abort from the reader pressing stop. */
export const CHAPTER_TIMEOUT_ERROR =
  "The model stopped responding. Nothing came back for 11 minutes."

export function createChapterGenerator(
  getConfig: () => ChapterGeneratorConfig | null,
  options: { timeoutMs?: number } = {},
): ChapterGenerator {
  const timeoutMs = options.timeoutMs ?? CHAPTER_WATCHDOG_MS

  return async function generateChapter(request) {
    const config = getConfig()
    if (!config?.profileId) {
      return { ok: false, error: "No model is selected." }
    }

    // Already stopped before this attempt began — a chapter scheduled in the
    // same tick a teardown landed. No reason to open a request to close it.
    if (request.signal.aborted) return { ok: false, error: "Cancelled." }

    /**
     * One controller for both reasons to stop.
     *
     * Composed by hand rather than with `AbortSignal.any` so the two causes
     * stay distinguishable: `request.signal` aborting is the reader, `timedOut`
     * is the watchdog, and the error the orchestrator records has to say which
     * — a run cancelled on purpose must not offer Retry as though it broke.
     */
    const controller = new AbortController()
    let timedOut = false

    const onOuterAbort = () => controller.abort()
    if (request.signal.aborted) controller.abort()
    else request.signal.addEventListener("abort", onOuterAbort, { once: true })

    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    /** The reason this attempt ended, in the order that matters. */
    const stopReason = (fallback: string): string => {
      if (request.signal.aborted) return "Cancelled."
      if (timedOut) return CHAPTER_TIMEOUT_ERROR
      return fallback
    }

    try {
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
          signal: controller.signal,
        })
      } catch (error) {
        return {
          ok: false,
          error: stopReason(
            error instanceof Error ? error.message : "Could not reach the model.",
          ),
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
        return {
          ok: false,
          error: stopReason(
            error instanceof Error ? error.message : "The stream ended early.",
          ),
        }
      }

      if (!text.trim()) return { ok: false, error: stopReason("The model returned nothing.") }
      return { ok: true, raw: text }
    } finally {
      // Always — a chapter that succeeded must not leave an 11-minute timer
      // holding a reference to a finished request.
      clearTimeout(timer)
      request.signal.removeEventListener("abort", onOuterAbort)
    }
  }
}
