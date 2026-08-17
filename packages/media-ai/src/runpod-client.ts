/**
 * The RunPod Serverless HTTP contract, and nothing else.
 *
 * Deliberately thin and dependency-free: `fetch` is injected, so every state a
 * cloud job can reach is reachable in a test without spending money or waiting
 * on a queue. The provider that uses this owns the policy — when to poll, when
 * to give up, what to clean up; this owns only the shape of the wire.
 *
 * Verified against the current documentation rather than a tutorial:
 *
 *     POST https://api.runpod.ai/v2/{endpointId}/run       submit, async
 *     GET  https://api.runpod.ai/v2/{endpointId}/status/{id}
 *     POST https://api.runpod.ai/v2/{endpointId}/cancel/{id}
 *     GET  https://api.runpod.ai/v2/{endpointId}/health
 *     Authorization: Bearer <api key>
 *
 * Results are retained for thirty minutes after completion, which is why the
 * provider downloads stems from storage rather than expecting them in the
 * status payload.
 */

/** Every state a job can be in. The last four are terminal. */
export type RunPodJobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"

const TERMINAL: RunPodJobStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL as string[]).includes(status)
}

/** Terminal, but not success — worth naming so callers cannot conflate them. */
export function isFailureStatus(status: string): boolean {
  return ["FAILED", "CANCELLED", "TIMED_OUT"].includes(status)
}

export type RunPodJob = {
  id: string
  status: RunPodJobStatus | string
  /** Present once the worker has returned something. */
  output?: unknown
  error?: unknown
  /** The worker's own progress payload, when it reports one. */
  stream?: unknown[]
  executionTime?: number
  delayTime?: number
}

export type RunPodHealth = {
  workers?: { idle?: number; running?: number; ready?: number; throttled?: number }
  jobs?: { completed?: number; failed?: number; inProgress?: number; inQueue?: number }
}

export type RunPodClientOptions = {
  apiKey: string
  endpointId: string
  /** Injected so tests never reach the network. */
  fetchImpl?: typeof fetch
  baseUrl?: string
  /** One request, not the whole job: the job is async by design. */
  requestTimeoutMs?: number
}

export class RunPodError extends Error {
  readonly status: number
  /** Bounded already: this is shown to a person behind a disclosure. */
  readonly detail: string

  constructor(message: string, status: number, detail = "") {
    super(message)
    this.name = "RunPodError"
    this.status = status
    this.detail = detail.slice(0, 2000)
  }
}

const DEFAULT_BASE = "https://api.runpod.ai/v2"

export class RunPodClient {
  private readonly apiKey: string
  private readonly endpointId: string
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly requestTimeoutMs: number

  constructor(options: RunPodClientOptions) {
    this.apiKey = options.apiKey
    this.endpointId = options.endpointId
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/${this.endpointId}${path}`, {
      ...init,
      headers: {
        // The one place the key is used. Never logged, never returned.
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new RunPodError(
        describeHttpFailure(response.status),
        response.status,
        // Redacted defensively: an error body should not echo a key back into
        // a database column that the browser renders.
        redactSecrets(body),
      )
    }

    return (await response.json()) as T
  }

  /**
   * Submit a job. Returns as soon as RunPod has accepted it.
   *
   * The payload carries keys into storage, never media — see the provider.
   */
  async submit(input: Record<string, unknown>): Promise<RunPodJob> {
    return this.call<RunPodJob>("/run", {
      method: "POST",
      body: JSON.stringify({ input }),
    })
  }

  async status(jobId: string): Promise<RunPodJob> {
    return this.call<RunPodJob>(`/status/${encodeURIComponent(jobId)}`, { method: "GET" })
  }

  async cancel(jobId: string): Promise<RunPodJob> {
    return this.call<RunPodJob>(`/cancel/${encodeURIComponent(jobId)}`, { method: "POST" })
  }

  async health(): Promise<RunPodHealth> {
    return this.call<RunPodHealth>("/health", { method: "GET" })
  }
}

/**
 * What an HTTP failure means, in words someone can act on.
 *
 * A bare "request failed with 401" tells a reader nothing about which of the
 * several credentials this feature needs was wrong.
 */
export function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403) {
    return "RunPod rejected the API key. Check the key in Settings — note that the S3 storage key is a different credential."
  }
  if (status === 404) {
    return "RunPod could not find that endpoint. Check the Serverless endpoint ID."
  }
  if (status === 429) {
    return "RunPod is rate limiting this account. Try again shortly."
  }
  if (status >= 500) {
    return "RunPod reported a server error. This is usually temporary."
  }
  return `RunPod returned an unexpected response (${status}).`
}

/**
 * Strip anything that looks like a credential out of provider output.
 *
 * Error bodies and worker logs are stored and rendered, and RunPod's own
 * formats are recognisable: API keys, the S3 access key (`user_…`) and its
 * secret (`rps_…`). Cheap insurance against a key reaching a database column.
 */
export function redactSecrets(text: string): string {
  if (!text) return ""
  return text
    .replace(/\b(rpa_[A-Za-z0-9]+)/g, "[redacted-api-key]")
    .replace(/\b(rps_[A-Za-z0-9]+)/g, "[redacted-s3-secret]")
    .replace(/\buser_[A-Za-z0-9]+/g, "[redacted-s3-key]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/("?(?:api[_-]?key|secret|password|token)"?\s*[:=]\s*"?)([^"\s,}]+)/gi, "$1[redacted]")
}

/**
 * Structured progress from the worker, if it reported any.
 *
 * The cloud worker emits the same shape the local separator's output is parsed
 * into, so both feed one persistence path and one estimate. Anything that does
 * not match is ignored rather than guessed at — an unrecognised payload must
 * not become a fabricated percentage.
 */
export function readWorkerProgress(
  payload: unknown,
): { completed: number; total: number; percent: number } | null {
  if (!payload || typeof payload !== "object") return null
  const entry = payload as Record<string, unknown>

  const completed = Number(entry.current ?? entry.completed)
  const total = Number(entry.total)
  if (!Number.isInteger(completed) || !Number.isInteger(total)) return null
  if (total < 2 || completed < 0 || completed > total) return null

  return {
    completed,
    total,
    percent: Math.max(0, Math.min(100, Math.round((completed / total) * 100))),
  }
}
