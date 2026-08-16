/** Shared HTTP helpers for Ollama local + Ollama Cloud (ollama.com). */

import { Agent, fetch as undiciFetch } from "undici"

/**
 * How long a single generation may take before we give up on it.
 *
 * A chapter of a book is one request that produces thousands of tokens, and on
 * a CPU-only host the first of them can be minutes away.
 */
export const OLLAMA_REQUEST_TIMEOUT_MS = 600_000

/**
 * The ceiling `AbortSignal.timeout` alone could not raise.
 *
 * Node's fetch is undici, and undici applies its **own** `headersTimeout` and
 * `bodyTimeout` — both 300 s by default — independently of any AbortSignal. So
 * a call written as `signal: AbortSignal.timeout(600_000)` was silently capped
 * at five minutes and failed with an opaque `fetch failed`.
 *
 * That is not a theoretical limit. At the ~1.9 tokens/sec a 3B model manages on
 * CPU, five minutes buys roughly 400 words — under the 450-word floor the book
 * validator enforces — so long-form generation could not succeed at all on such
 * a host, and the failure gave no hint why. Raising both timeouts to match the
 * intended ceiling is what makes the documented 600 seconds real.
 *
 * `headersTimeout` is the one that actually bites: Ollama sends no response
 * head until it has loaded the model and evaluated the prompt.
 */
const ollamaDispatcher = new Agent({
  headersTimeout: OLLAMA_REQUEST_TIMEOUT_MS,
  bodyTimeout: OLLAMA_REQUEST_TIMEOUT_MS,
})

/**
 * Fetch for long Ollama generations, with the ceiling above actually applied.
 *
 * undici's own `fetch` rather than the global one, because the two are not
 * interchangeable here: handing this Agent to Node's built-in fetch fails
 * instantly with `invalid onRequestStart method` — the bundled and packaged
 * undici disagree about the interceptor API. Taking both halves from the same
 * package is what makes the dispatcher take effect.
 *
 * Returns a normal streaming `Response`; callers read `res.body.getReader()`
 * exactly as before.
 *
 * The cast is at the type level only. undici's `Response` and the global one
 * differ in how precisely they describe `body`'s chunk type, not in behaviour —
 * both stream `Uint8Array` — and confining the cast here keeps every call site
 * working with the ordinary web type.
 */
export function ollamaFetch(
  url: string,
  init: Parameters<typeof undiciFetch>[1],
): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher: ollamaDispatcher }) as unknown as Promise<Response>
}

export function ollamaAuthHeaders(apiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const key = apiKey?.trim()
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

export function formatOllamaProviderError(
  status: number,
  bodyText: string,
  opts?: { hasApiKey?: boolean; isCloud?: boolean },
): string {
  if (status === 500 || status === 502 || status === 503) {
    const snippet = bodyText.trim().slice(0, 200)
    return snippet
      ? `Ollama Cloud error (${status}): ${snippet}`
      : `Ollama Cloud error (${status}). Try another model or check ollama.com status.`
  }
  if (status === 401 || status === 403) {
    if (opts?.isCloud || opts?.hasApiKey) {
      return (
        "Ollama Cloud rejected your API key (401). Create or rotate a key at " +
        "https://ollama.com/settings/api-keys and save it under Models → Ollama Cloud."
      )
    }
    return (
      "Ollama returned 401 unauthorized. Cloud models require an API key from " +
      "ollama.com/settings/api-keys."
    )
  }
  const snippet = bodyText.trim().slice(0, 200)
  return snippet ? `Provider error ${status}: ${snippet}` : `Provider error ${status}`
}

export function assertOllamaCloudApiKey(
  provider: string,
  apiKey: string | null | undefined,
): { code: string; message: string } | null {
  if (provider !== "ollama-cloud") return null
  if (apiKey?.trim()) return null
  return {
    code: "OLLAMA_CLOUD_KEY_REQUIRED",
    message:
      "Ollama Cloud requires an API key. Add one from ollama.com/settings/api-keys under Models → Ollama Cloud.",
  }
}

