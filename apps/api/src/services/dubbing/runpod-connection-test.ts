import {
  RunPodClient,
  RunPodError,
  S3CloudSeparationStorage,
  isFailureStatus,
  type CloudSeparationStorage,
} from "@arciin/media-ai"

import type { RunPodCredentials } from "./runpod-config"

/**
 * Proving a RunPod connection actually works, layer by layer.
 *
 * "Connected" must not mean "an API key was typed in". Five separate things can
 * be wrong, they fail in different places, and three of them look identical
 * from the outside if you only check the first: a valid key against a deleted
 * endpoint, a valid endpoint with the volume attached to a different
 * datacenter, and a perfectly healthy worker that quietly runs on CPU.
 *
 * That last one is the reason this exists in its current form. A GPU endpoint
 * that has silently fallen back to CPU will separate correctly and slowly while
 * billing for a GPU — indistinguishable from success unless something asks.
 *
 * Each layer is reported separately so a failure names the thing to fix rather
 * than saying "connection failed".
 */

export type ConnectionLayer =
  | "api"
  | "endpoint"
  | "storage"
  | "gpu"
  | "model"

export type LayerResult = {
  layer: ConnectionLayer
  label: string
  ok: boolean
  /** Shown on success too: "NVIDIA RTX A4000", "htdemucs". */
  detail?: string
  /** Why it failed, in terms of what to change. */
  reason?: string
}

export type ConnectionTestResult = {
  ok: boolean
  layers: LayerResult[]
  /** Carried into the settings summary when the whole thing passes. */
  gpuName?: string | null
  cudaAvailable?: boolean | null
  separatorVersion?: string | null
  model?: string | null
}

const LABELS: Record<ConnectionLayer, string> = {
  api: "RunPod API",
  endpoint: "Serverless endpoint",
  storage: "Cloud storage",
  gpu: "GPU / CUDA",
  model: "Separator model",
}

/** How long to wait for a health job to be picked up and answered. */
const HEALTH_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 2_000

export type ConnectionTestDeps = {
  client?: RunPodClient
  storage?: CloudSeparationStorage
  /** Injected so the whole sequence is testable without a paid account. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function testRunPodConnection(
  credentials: RunPodCredentials,
  deps: ConnectionTestDeps = {},
): Promise<ConnectionTestResult> {
  const client =
    deps.client ?? new RunPodClient({ apiKey: credentials.apiKey, endpointId: credentials.endpointId })
  const storage =
    deps.storage ??
    new S3CloudSeparationStorage({
      endpoint: credentials.s3Endpoint,
      region: credentials.datacenter,
      bucket: credentials.volumeId,
      accessKeyId: credentials.s3AccessKeyId,
      secretAccessKey: credentials.s3SecretAccessKey,
    })
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => Date.now())

  const layers: LayerResult[] = []
  const fail = (layer: ConnectionLayer, reason: string): ConnectionTestResult => {
    layers.push({ layer, label: LABELS[layer], ok: false, reason })
    // Everything after a failure is unknown rather than passing, and saying so
    // is more useful than a row of untested ticks.
    for (const remaining of (["api", "endpoint", "storage", "gpu", "model"] as ConnectionLayer[])) {
      if (!layers.some((l) => l.layer === remaining)) {
        layers.push({ layer: remaining, label: LABELS[remaining], ok: false, reason: "Not tested." })
      }
    }
    return { ok: false, layers }
  }

  // ── 1. the API key ──────────────────────────────────────────────────────
  let health
  try {
    health = await client.health()
    layers.push({ layer: "api", label: LABELS.api, ok: true })
  } catch (error) {
    const reason =
      error instanceof RunPodError ? error.message : "Could not reach the RunPod API."
    // A 401 here is the key; a 404 is the endpoint id. `describeHttpFailure`
    // already separates them.
    return fail("api", reason)
  }

  // ── 2. the endpoint ─────────────────────────────────────────────────────
  const workers = health.workers ?? {}
  const knownWorkers =
    (workers.idle ?? 0) + (workers.running ?? 0) + (workers.ready ?? 0) + (workers.throttled ?? 0)
  layers.push({
    layer: "endpoint",
    label: LABELS.endpoint,
    ok: true,
    // Zero workers is normal for a scale-to-zero endpoint, so it is reported
    // rather than treated as a fault.
    detail: knownWorkers > 0 ? `${knownWorkers} worker(s)` : "idle (scales to zero)",
  })

  // ── 3. storage ──────────────────────────────────────────────────────────
  const storageResult = await storage.testConnection()
  if (!storageResult.ok) {
    return fail("storage", storageResult.reason)
  }
  layers.push({
    layer: "storage",
    label: LABELS.storage,
    ok: true,
    detail: credentials.datacenter,
  })

  /**
   * ── 4 and 5. the worker itself ────────────────────────────────────────
   *
   * Everything above can pass while the thing that matters is wrong, so this
   * runs a real job on the endpoint. It is the only way to learn whether CUDA
   * is present inside the worker and whether the separator is installed there —
   * neither is visible from the control plane.
   */
  let job
  try {
    job = await client.submit({ op: "health" })
  } catch (error) {
    return fail("gpu", error instanceof RunPodError ? error.message : "Could not start a worker.")
  }

  const deadline = now() + HEALTH_TIMEOUT_MS
  let final = job
  while (!isTerminal(final.status) && now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    try {
      final = await client.status(job.id)
    } catch (error) {
      return fail("gpu", error instanceof RunPodError ? error.message : "Lost contact with the job.")
    }
  }

  if (!isTerminal(final.status)) {
    return fail(
      "gpu",
      "The endpoint did not start a worker in time. A cold start can be slow — try again, or check the endpoint's worker limits.",
    )
  }
  if (isFailureStatus(final.status)) {
    return fail("gpu", `The health job ended as ${final.status}.`)
  }

  const output = (final.output ?? {}) as {
    gpu?: { cuda_available?: boolean; gpu_name?: string; cuda_version?: string }
    separator?: { version?: string; implementation?: string; drift?: string }
    model?: string
    separator_available?: boolean
    volume_mounted?: boolean
  }

  const gpu = output.gpu ?? {}
  if (!gpu.cuda_available) {
    /**
     * The refusal that gives the whole cloud path its point. A worker without
     * CUDA will separate on CPU: correct, slow, and billed as a GPU. Calling
     * that "connected" would hide the one failure the user is paying to avoid.
     */
    return fail(
      "gpu",
      "The worker started but CUDA is not available inside it, so separation would run on CPU. Check that the endpoint uses a GPU image and a GPU worker type.",
    )
  }
  layers.push({
    layer: "gpu",
    label: LABELS.gpu,
    ok: true,
    detail: gpu.gpu_name ? `${gpu.gpu_name}${gpu.cuda_version ? ` · CUDA ${gpu.cuda_version}` : ""}` : "available",
  })

  // ── 5. the separator and its model ──────────────────────────────────────
  if (!output.separator_available) {
    return fail("model", "The worker image does not have the audio separator installed.")
  }
  if (!output.volume_mounted) {
    return fail(
      "model",
      "The worker has no network volume mounted. Attach the volume to this endpoint.",
    )
  }

  const separator = output.separator ?? {}
  layers.push({
    layer: "model",
    label: LABELS.model,
    ok: true,
    detail: [output.model, separator.version ? `separator ${separator.version}` : null]
      .filter(Boolean)
      .join(" · "),
    // Surfaced rather than failed: a drifted image still works, it just cannot
    // share a stem cache with this server.
    ...(separator.drift ? { reason: `Note: ${separator.drift}` } : {}),
  })

  return {
    ok: true,
    layers,
    gpuName: gpu.gpu_name ?? null,
    cudaAvailable: true,
    separatorVersion: separator.version ?? null,
    model: output.model ?? null,
  }
}

function isTerminal(status: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status)
}
