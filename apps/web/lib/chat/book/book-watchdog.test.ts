/**
 * The hung-stream watchdog.
 *
 * The failure this guards against leaves no trace: a fetch that never settles
 * holds the orchestrator's single-flight lock for the rest of the session, so
 * the book neither finishes nor fails — the card just keeps saying "writing"
 * for ever. Every case below is about making that end in a state the reader can
 * act on.
 *
 * The timeout is passed in rather than waiting eleven minutes; what is under
 * test is the composition of the two abort reasons, not the duration.
 *
 * Run with:  node_modules/.bin/tsx lib/chat/book/book-watchdog.test.ts
 */

import {
  CHAPTER_TIMEOUT_ERROR,
  CHAPTER_WATCHDOG_MS,
  createChapterGenerator,
} from "./book-chapter-generator"
import {
  __resetBookOrchestratorForTests,
  MAX_CHAPTER_ATTEMPTS,
  useBookRun,
} from "./book-orchestrator"
import { MemoryBookRepository, setBookRepository } from "./book-storage"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function section(name: string) {
  console.log(`\n${name}`)
}

const CONFIG = { profileId: "p1", model: "m1" }

/** A fetch that accepts the request and then never answers. */
function hangingFetch(): typeof globalThis.fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.")
        err.name = "AbortError"
        reject(err)
      })
    })) as unknown as typeof globalThis.fetch
}

/** A fetch that opens a stream, sends one token, then stalls for ever. */
function stallingStreamFetch(): typeof globalThis.fetch {
  return ((_url: string, init?: RequestInit) => {
    const signal = init?.signal
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ text: "Once upon" })}\n`),
        )
        signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.")
          err.name = "AbortError"
          controller.error(err)
        })
        // and then nothing, for ever
      },
    })
    return Promise.resolve(new Response(stream, { status: 200 }))
  }) as unknown as typeof globalThis.fetch
}

function okStreamFetch(body: string): typeof globalThis.fetch {
  return (() => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ text: body })}\n\ndata: [DONE]\n`),
        )
        controller.close()
      },
    })
    return Promise.resolve(new Response(stream, { status: 200 }))
  }) as unknown as typeof globalThis.fetch
}

function makeRequest(over: Partial<Parameters<ReturnType<typeof createChapterGenerator>>[0]> = {}) {
  const controller = new AbortController()
  return {
    controller,
    request: {
      prompt: "write chapter 2",
      chapter: 2,
      operationId: "op-1",
      onToken: () => {},
      signal: controller.signal,
      ...over,
    },
  }
}

async function main() {
  const realFetch = globalThis.fetch

  section("The ceiling sits above the provider's own")
  {
    // apps/api/src/services/chat/ollama-chat-with-tools.ts aborts at 600s. A
    // browser watchdog below that would be the thing killing honest chapters.
    check("660 seconds, not 600", CHAPTER_WATCHDOG_MS === 660_000, String(CHAPTER_WATCHDOG_MS))
    check("above the provider ceiling", CHAPTER_WATCHDOG_MS > 600_000)
  }

  section("A request that never answers")
  {
    globalThis.fetch = hangingFetch()
    const generate = createChapterGenerator(() => CONFIG, { timeoutMs: 60 })
    const { request } = makeRequest()
    const started = Date.now()
    const result = await generate(request)
    check("it settles rather than hanging", Date.now() - started < 5000)
    check("it fails", result.ok === false)
    check(
      "with the timeout's own reason",
      !result.ok && result.error === CHAPTER_TIMEOUT_ERROR,
      !result.ok ? result.error : "",
    )
  }

  section("A stream that opens and then stalls")
  {
    globalThis.fetch = stallingStreamFetch()
    const generate = createChapterGenerator(() => CONFIG, { timeoutMs: 60 })
    const { request } = makeRequest()
    const result = await generate(request)
    check("a half-written chapter still ends", result.ok === false)
    check(
      "and says the model stopped responding",
      !result.ok && result.error === CHAPTER_TIMEOUT_ERROR,
      !result.ok ? result.error : "",
    )
  }

  section("An explicit stop is still an explicit stop")
  {
    globalThis.fetch = hangingFetch()
    // A watchdog long enough that only the reader can end this.
    const generate = createChapterGenerator(() => CONFIG, { timeoutMs: 10_000 })
    const { controller, request } = makeRequest()
    setTimeout(() => controller.abort(), 30)
    const result = await generate(request)
    check("it fails", result.ok === false)
    check(
      "reported as cancelled, not as a timeout",
      !result.ok && result.error === "Cancelled.",
      !result.ok ? result.error : "",
    )
  }

  section("A signal already aborted never reaches the model")
  {
    let called = false
    globalThis.fetch = ((...args: unknown[]) => {
      called = true
      return hangingFetch()(...(args as Parameters<typeof globalThis.fetch>))
    }) as unknown as typeof globalThis.fetch
    const generate = createChapterGenerator(() => CONFIG, { timeoutMs: 10_000 })
    const { controller, request } = makeRequest()
    controller.abort()
    const result = await generate(request)
    check("it fails as cancelled", !result.ok && result.error === "Cancelled.")
    check("and no request was opened at all", called === false)
  }

  section("A chapter that arrives normally is untouched")
  {
    globalThis.fetch = okStreamFetch("## Chapter 2: A Title\n\nprose")
    const generate = createChapterGenerator(() => CONFIG, { timeoutMs: 10_000 })
    const tokens: string[] = []
    const { request } = makeRequest({ onToken: (t: string) => tokens.push(t) })
    const result = await generate(request)
    check("it succeeds", result.ok === true)
    check("the text is intact", result.ok && result.raw.includes("## Chapter 2: A Title"))
    check("tokens streamed", tokens.length > 0)
  }

  section("A timed-out chapter releases the lock and becomes retryable")
  {
    __resetBookOrchestratorForTests()
    setBookRepository(new MemoryBookRepository())
    useBookRun.setState({
      project: null,
      manuscript: "",
      streamingText: "",
      streamingChapter: null,
      phase: null,
      operationId: null,
      lastRejection: null,
      planning: null,
    })

    globalThis.fetch = hangingFetch()
    useBookRun.getState().setGenerator(createChapterGenerator(() => CONFIG, { timeoutMs: 40 }))

    const PLAN = `# A Book

## Contents

1. One — the first
2. Two — the second

## Chapter 1: One

${"A sentence of ordinary prose that goes on for a while. ".repeat(50)}
`
    useBookRun.getState().startFromPlan({ conversationId: "wd", brief: "b", manuscript: PLAN })

    // Long enough for every bounded attempt to time out in turn.
    const deadline = Date.now() + 6000
    for (;;) {
      await new Promise((r) => setTimeout(r, 25))
      const s = useBookRun.getState().project
      if (s && (s.status === "failed" || s.status === "completed")) break
      if (Date.now() > deadline) break
    }

    const final = useBookRun.getState()
    check("the run ends failed, not stuck", final.project?.status === "failed", final.project?.status)
    check(
      "the reason names the timeout",
      final.project?.lastError === CHAPTER_TIMEOUT_ERROR,
      final.project?.lastError,
    )
    check("nothing is left in flight", final.streamingChapter === null && final.operationId === null)
    check("the phase is cleared", final.phase === null, String(final.phase))
    check("chapter 1 survived", final.project?.written === 1, String(final.project?.written))
    check(
      "it gave up only after the bounded attempts",
      (final.project?.attempts ?? 0) >= MAX_CHAPTER_ATTEMPTS,
      String(final.project?.attempts),
    )

    // Retry: the lock must be free, or nothing would start.
    globalThis.fetch = okStreamFetch(
      `## Chapter 2: Two\n\n${"Prose that is long enough to be a chapter and not a summary. ".repeat(60)}`,
    )
    useBookRun.getState().retryCurrent()
    const retryDeadline = Date.now() + 4000
    for (;;) {
      await new Promise((r) => setTimeout(r, 25))
      const s = useBookRun.getState().project
      if (s && (s.status === "completed" || s.status === "failed")) break
      if (Date.now() > retryDeadline) break
    }
    const after = useBookRun.getState().project
    check("Retry writes the chapter that timed out", after?.written === 2, String(after?.written))
    check("and the book completes", after?.status === "completed", after?.status)
  }

  globalThis.fetch = realFetch
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void main()
