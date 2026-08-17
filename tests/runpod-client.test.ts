import { describe, expect, it, vi } from "vitest"

import {
  RunPodClient,
  RunPodError,
  describeHttpFailure,
  isFailureStatus,
  isTerminalStatus,
  readWorkerProgress,
  redactSecrets,
} from "../packages/media-ai/src/runpod-client"

/**
 * The RunPod wire contract, exercised without spending anything.
 *
 * `fetch` is injected, so every state a cloud job can reach — queued, running,
 * completed, failed, cancelled, timed out — is reachable here. Paying a
 * provider to observe its own error codes would be a poor way to learn them,
 * and some of these states are difficult to provoke on purpose at all.
 *
 * The URLs and status values below are the documented contract, not a guess:
 * api.runpod.ai/v2/{id}/{run,status,cancel,health} with a bearer key.
 */

/** A fetch that records what it was asked and answers from a script. */
function scriptedFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
  let index = 0

  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const entry = responses[Math.min(index, responses.length - 1)]!
    index += 1
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    })
    const status = entry.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => entry.body,
      text: async () => (typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body)),
    } as unknown as Response
  })

  return { impl: impl as unknown as typeof fetch, calls }
}

function client(fetchImpl: typeof fetch) {
  return new RunPodClient({ apiKey: "rpa_test_key", endpointId: "ep123", fetchImpl })
}

describe("job states", () => {
  it("knows which states are the end of a job", () => {
    for (const status of ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]) {
      expect(isTerminalStatus(status)).toBe(true)
    }
    for (const status of ["IN_QUEUE", "IN_PROGRESS"]) {
      expect(isTerminalStatus(status)).toBe(false)
    }
  })

  it("separates finishing from succeeding", () => {
    // A cancelled job is over; it is not a result. Conflating the two would
    // hand the pipeline a missing stem and let it carry on.
    expect(isFailureStatus("COMPLETED")).toBe(false)
    for (const status of ["FAILED", "CANCELLED", "TIMED_OUT"]) {
      expect(isFailureStatus(status)).toBe(true)
    }
  })

  it("treats an unrecognised state as still running rather than done", () => {
    // Safer: waiting on a job that has ended costs a poll, whereas treating an
    // unknown state as finished would look for stems that were never written.
    expect(isTerminalStatus("SOMETHING_NEW")).toBe(false)
  })
})

describe("RunPodClient", () => {
  it("submits to the documented URL with the key as a bearer token", async () => {
    const { impl, calls } = scriptedFetch([{ body: { id: "job-1", status: "IN_QUEUE" } }])
    const job = await client(impl).submit({ input_key: "cloud/jobs/x/source.wav" })

    expect(job).toEqual({ id: "job-1", status: "IN_QUEUE" })
    expect(calls[0]!.url).toBe("https://api.runpod.ai/v2/ep123/run")
    expect(calls[0]!.method).toBe("POST")
    expect(calls[0]!.headers.Authorization).toBe("Bearer rpa_test_key")
  })

  it("wraps the payload in `input`, as the handler contract expects", async () => {
    const { impl, calls } = scriptedFetch([{ body: { id: "job-1", status: "IN_QUEUE" } }])
    await client(impl).submit({ input_key: "k", model: "htdemucs.yaml" })

    const sent = JSON.parse(calls[0]!.body!) as { input: Record<string, unknown> }
    expect(sent.input).toEqual({ input_key: "k", model: "htdemucs.yaml" })
    // Keys into storage, never media: a WAV in a JSON body is the thing this
    // whole design exists to avoid.
    expect(calls[0]!.body!.length).toBeLessThan(500)
  })

  it("reads status and cancels by job id", async () => {
    const { impl, calls } = scriptedFetch([
      { body: { id: "job-1", status: "IN_PROGRESS" } },
      { body: { id: "job-1", status: "CANCELLED" } },
    ])
    const runpod = client(impl)

    expect((await runpod.status("job-1")).status).toBe("IN_PROGRESS")
    expect((await runpod.cancel("job-1")).status).toBe("CANCELLED")

    expect(calls[0]!.url).toBe("https://api.runpod.ai/v2/ep123/status/job-1")
    expect(calls[1]!.url).toBe("https://api.runpod.ai/v2/ep123/cancel/job-1")
    expect(calls[1]!.method).toBe("POST")
  })

  it("escapes a job id rather than pasting it into a URL", async () => {
    const { impl, calls } = scriptedFetch([{ body: { id: "x", status: "COMPLETED" } }])
    await client(impl).status("weird/id?x=1")
    expect(calls[0]!.url).toContain("weird%2Fid%3Fx%3D1")
  })

  it("names which credential was rejected on a 401", async () => {
    const { impl } = scriptedFetch([{ status: 401, body: "unauthorized" }])
    const error = (await client(impl)
      .health()
      .catch((e: unknown) => e)) as RunPodError

    expect(error).toBeInstanceOf(RunPodError)
    expect(error.status).toBe(401)
    /**
     * This feature needs two different RunPod credentials, and the most likely
     * mistake is using one where the other belongs. A bare "401" would leave
     * the reader guessing which.
     */
    expect(error.message).toMatch(/S3 storage key is a different credential/i)
  })

  it("never lets a credential travel in an error detail", async () => {
    const { impl } = scriptedFetch([
      {
        status: 400,
        body: 'bad request for {"api_key":"rpa_supersecret","s3_secret":"rps_alsosecret"}',
      },
    ])
    const error = (await client(impl)
      .submit({})
      .catch((e: unknown) => e)) as RunPodError

    // Details are stored and rendered, so this is the last place a key could
    // leak into a database column.
    expect(error.detail).not.toContain("rpa_supersecret")
    expect(error.detail).not.toContain("rps_alsosecret")
    expect(error.detail).toContain("[redacted")
  })

  it("reports endpoint health", async () => {
    const { impl, calls } = scriptedFetch([
      { body: { workers: { idle: 1, ready: 1 }, jobs: { inQueue: 0 } } },
    ])
    const health = await client(impl).health()

    expect(health.workers?.ready).toBe(1)
    expect(calls[0]!.url).toBe("https://api.runpod.ai/v2/ep123/health")
  })
})

describe("describeHttpFailure", () => {
  it("explains the failures a person can do something about", () => {
    expect(describeHttpFailure(404)).toMatch(/endpoint ID/i)
    expect(describeHttpFailure(429)).toMatch(/rate limiting/i)
    expect(describeHttpFailure(503)).toMatch(/temporary/i)
  })
})

describe("redactSecrets", () => {
  it("removes RunPod's own credential formats", () => {
    const raw = "key rpa_abc123 and user_def456 with rps_ghi789"
    const clean = redactSecrets(raw)
    expect(clean).not.toContain("rpa_abc123")
    expect(clean).not.toContain("user_def456")
    expect(clean).not.toContain("rps_ghi789")
  })

  it("removes bearer tokens and labelled secrets", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123")).not.toContain("abc.def-123")
    expect(redactSecrets('{"secret":"hunter2"}')).not.toContain("hunter2")
  })

  it("leaves ordinary diagnostics readable", () => {
    const message = "CUDA out of memory while loading htdemucs"
    expect(redactSecrets(message)).toBe(message)
  })
})

describe("readWorkerProgress", () => {
  it("accepts the shape the cloud worker emits", () => {
    expect(readWorkerProgress({ stage: "separating", current: 39, total: 122 })).toEqual({
      completed: 39,
      total: 122,
      percent: 32,
    })
  })

  it("accepts `completed` as well as `current`", () => {
    expect(readWorkerProgress({ completed: 10, total: 100 })?.percent).toBe(10)
  })

  it("refuses anything it cannot defend", () => {
    /**
     * An unrecognised payload must not become a fabricated percentage — the
     * whole point of the local progress work was that a made-up number is worse
     * than no number.
     */
    expect(readWorkerProgress(null)).toBeNull()
    expect(readWorkerProgress("separating")).toBeNull()
    expect(readWorkerProgress({ percent: 50 })).toBeNull()
    expect(readWorkerProgress({ current: 5, total: 1 })).toBeNull()
    expect(readWorkerProgress({ current: 1.5, total: 10 })).toBeNull()
    expect(readWorkerProgress({ current: 1, total: 1 })).toBeNull()
  })
})
