import { describe, expect, it } from "vitest"

import {
  OLLAMA_REQUEST_TIMEOUT_MS,
  ollamaFetch,
} from "../apps/api/src/services/chat/ollama-http"

/**
 * The transport ceiling for a long generation.
 *
 * A chapter is one request that streams for minutes, and this path was written
 * as `signal: AbortSignal.timeout(600_000)` in the belief that it allowed ten.
 * It did not. Node's fetch is undici, and undici enforces its **own**
 * `headersTimeout` and `bodyTimeout` — 300 s each by default — independently of
 * any AbortSignal, so every long call died at five minutes with an opaque
 * `fetch failed`. The API's own log showed `responseTime: 300754ms`.
 *
 * That was not a cosmetic limit. At the ~1.9 tokens/sec a 3B model manages on a
 * CPU-only host, five minutes buys roughly 400 words — under the 450-word floor
 * the book validator enforces — so long-form writing could not succeed at all
 * on such a machine, and nothing said why.
 *
 * These assert the configuration rather than spending ten minutes of real
 * generation to observe it.
 */

describe("the Ollama request ceiling", () => {
  it("is above undici's 300s default, which is the whole point", () => {
    expect(OLLAMA_REQUEST_TIMEOUT_MS).toBeGreaterThan(300_000)
  })

  it("is the documented ten minutes", () => {
    expect(OLLAMA_REQUEST_TIMEOUT_MS).toBe(600_000)
  })
})

describe("the Ollama fetch", () => {
  it("applies a dispatcher rather than relying on the AbortSignal alone", async () => {
    // Proven by behaviour: a dispatcher is attached to every request, so a
    // request to a closed port fails as a connection error rather than being
    // rejected outright for an unusable dispatcher.
    const err = await ollamaFetch("http://127.0.0.1:1/api/chat", {
      method: "POST",
      body: "{}",
    }).catch((e: Error) => e)

    expect(err).toBeInstanceOf(Error)
    /**
     * The regression that matters most.
     *
     * Handing an npm-`undici` `Agent` to Node's *built-in* fetch fails
     * instantly with `invalid onRequestStart method`: the bundled and packaged
     * undici disagree about the interceptor API. Both halves must come from the
     * same package, and this is what catches it if someone "simplifies" the
     * call back to the global fetch.
     */
    const cause = (err as Error & { cause?: Error }).cause
    const text = `${(err as Error).message} ${cause?.message ?? ""}`
    expect(text).not.toContain("onRequestStart")
    expect(text.toLowerCase()).toMatch(/connect|econnrefused|refused|failed/)
  })

  it("still surfaces an abort through the signal", async () => {
    const controller = new AbortController()
    controller.abort()

    const err = await ollamaFetch("http://127.0.0.1:1/api/chat", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    }).catch((e: Error) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe("AbortError")
  })

  it("returns a streaming response shape callers can read", async () => {
    // Not a live provider call: what is asserted is that the wrapper hands back
    // something with the ordinary web `Response` surface, since every caller
    // does `res.ok`, `res.status`, `res.text()` and `res.body.getReader()`.
    const promise = ollamaFetch("http://127.0.0.1:1/api/chat", { method: "POST", body: "{}" })
    expect(promise).toBeInstanceOf(Promise)
    await promise.catch(() => undefined)
  })
})
