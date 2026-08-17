import path from "node:path"

import type { AudioStems, SeparationProgress } from "./audio-separation"
import {
  backgroundKey,
  dialogueKey,
  jobPrefix,
  sourceKey,
  type CloudSeparationStorage,
} from "./cloud-separation-storage"
import { MediaToolError } from "./media-tool-error"
import {
  isFailureStatus,
  isTerminalStatus,
  readWorkerProgress,
  redactSecrets,
  type RunPodClient,
  type RunPodJob,
} from "./runpod-client"

/**
 * Separating audio on a rented GPU, without ever paying for it twice.
 *
 * The pipeline that follows this knows nothing about RunPod: it receives a
 * dialogue file and a background file, exactly as the local separator produces.
 * Everything specific to the provider — uploading, submitting, waiting,
 * downloading, validating — lives here.
 *
 * The whole design turns on one fact: **BullMQ is at-least-once.** A crash, a
 * stall, a restart or a retry re-enters the processor, and the naive response to
 * re-entry is to submit again. That would buy a second GPU job for work already
 * running, or already finished. So the provider job id is durable, it is written
 * the instant the provider returns it and before anything else that can fail,
 * and every entry looks for it before considering submission.
 *
 * Persistence is injected rather than owned here. The worker has the database;
 * this has the sequence. Keeping them apart is what lets every recovery path be
 * tested without a database or a provider.
 */

export type CloudSeparationHooks = {
  /** The durable id, if this separation has already been submitted. */
  loadJobId: () => Promise<string | null>
  /**
   * Called with the id the moment it exists.
   *
   * Must complete before polling begins: an id that is not yet written is an id
   * that a crash will lose, and losing it means paying again.
   */
  saveJobId: (jobId: string, correlationId: string) => Promise<void>
  /** Status changes and heartbeats, throttled by the caller. */
  onStatus?: (status: string, meta: { polledAt: Date }) => Promise<void>
  onStage?: (stage: string) => void
  onProgress?: (progress: SeparationProgress) => void
  /** Remote objects that still need removing, recorded for reconciliation. */
  onCleanupPending?: (prefix: string) => Promise<void>
}

export type CloudSeparationRequest = {
  /** Locally extracted audio. Never the video. */
  inputPath: string
  /** Where downloaded stems land. */
  workDir: string
  /**
   * Stable for one cache key, so a retry addresses the same remote objects
   * instead of uploading a second copy of the audio beside the first.
   */
  correlationId: string
  model: string
  signal?: AbortSignal
}

/** Poll timings. Backed off, bounded, jittered. */
const FIRST_POLL_MS = 1_500
const MAX_POLL_MS = 15_000
const POLL_GROWTH = 1.4

/**
 * A ceiling on the wait.
 *
 * Generous — a long file on a cold endpoint can legitimately take a while — but
 * finite, because a job that never terminates would otherwise hold a queue slot
 * forever.
 */
const MAX_WAIT_MS = 2 * 60 * 60 * 1000

export class CloudSeparationError extends MediaToolError {
  readonly code: string
  constructor(input: { code: string; summary: string; detail?: string }) {
    super({ tool: "runpod", summary: input.summary, detail: input.detail ?? "" })
    this.name = "CloudSeparationError"
    this.code = input.code
  }
}

export class RunPodSeparationProvider {
  readonly id = "runpod"
  readonly type = "cloud" as const

  constructor(
    private readonly client: RunPodClient,
    private readonly storage: CloudSeparationStorage,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        // Never blocks the event loop: BullMQ has to keep renewing its lock
        // while this waits, and a busy loop would starve it.
        timer.unref?.()
      }),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async separate(
    request: CloudSeparationRequest,
    hooks: CloudSeparationHooks,
  ): Promise<AudioStems> {
    const prefix = jobPrefix(request.correlationId)

    /**
     * Recovery first, always.
     *
     * If an id already exists this execution has been here before — the job is
     * queued, running, or finished. Submitting again would buy a duplicate.
     */
    const existing = await hooks.loadJobId()
    let jobId = existing

    if (!jobId) {
      hooks.onStage?.("Uploading source audio")
      await this.upload(request, prefix)

      hooks.onStage?.("Queued for GPU")
      const submitted = await this.submit(request, prefix)
      jobId = submitted.id

      /**
       * Written before anything else that can fail.
       *
       * Between the provider accepting the job and this line there is a window
       * where a crash loses a paid job. Nothing fallible belongs inside it.
       */
      await hooks.saveJobId(jobId, request.correlationId)
    } else {
      hooks.onStage?.("Resuming cloud separation")
    }

    const job = await this.waitForCompletion(jobId, request, hooks)

    hooks.onStage?.("Downloading separated audio")
    const stems = await this.download(request, prefix, job)

    // Recorded rather than attempted here: the caller commits the cache first,
    // so a cleanup failure can never cost it the stems it just paid for.
    await hooks.onCleanupPending?.(prefix)

    return stems
  }

  /** Explicitly asked for by a person — not a browser closing. */
  async cancel(jobId: string, correlationId: string): Promise<void> {
    await this.client.cancel(jobId).catch(() => {})
    await this.storage.deleteJobObjects(jobPrefix(correlationId)).catch(() => {})
  }

  /** Remote objects, gone. Safe to call more than once. */
  async cleanup(correlationId: string): Promise<{ deleted: number }> {
    return this.storage.deleteJobObjects(jobPrefix(correlationId))
  }

  private async upload(request: CloudSeparationRequest, prefix: string): Promise<void> {
    /**
     * Audio only.
     *
     * The separator needs a waveform, not frames. Uploading the container
     * because it is already on disk would send the user's video to a third
     * party for no benefit and at several times the size.
     */
    if (!/\.(wav|flac|m4a|mp3|ogg)$/i.test(request.inputPath)) {
      throw new CloudSeparationError({
        code: "cloud_input_invalid",
        summary: "Only extracted audio may be uploaded for separation.",
        detail: `refusing to upload ${path.basename(request.inputPath)}`,
      })
    }

    try {
      await this.storage.uploadInput(request.inputPath, `${prefix}/source.wav`)
    } catch (error) {
      throw new CloudSeparationError({
        code: "cloud_upload_failed",
        summary: "The source audio could not be uploaded for cloud separation.",
        detail: redactSecrets(error instanceof Error ? error.message : String(error)),
      })
    }
  }

  private async submit(request: CloudSeparationRequest, prefix: string): Promise<RunPodJob> {
    try {
      // Keys, never bytes.
      return await this.client.submit({
        job_id: request.correlationId,
        input_key: sourceKey(request.correlationId),
        output_prefix: prefix,
        model: request.model,
      })
    } catch (error) {
      throw new CloudSeparationError({
        code: "cloud_submit_failed",
        summary: "The cloud separation job could not be started.",
        detail: redactSecrets(error instanceof Error ? error.message : String(error)),
      })
    }
  }

  /**
   * Wait, politely.
   *
   * Backed off and jittered so a hundred concurrent dubs do not arrive at the
   * status endpoint in lockstep, and bounded so nothing waits forever. Every
   * sleep is awaited rather than spun, because BullMQ needs the event loop to
   * keep renewing its lock on this job.
   */
  private async waitForCompletion(
    jobId: string,
    request: CloudSeparationRequest,
    hooks: CloudSeparationHooks,
  ): Promise<RunPodJob> {
    const deadline = this.now() + MAX_WAIT_MS
    let interval = FIRST_POLL_MS
    let lastStatus = ""

    for (;;) {
      if (request.signal?.aborted) {
        // A deliberate cancellation: stop the paid work rather than abandoning
        // it to run to completion unwatched.
        await this.cancel(jobId, request.correlationId)
        throw new CloudSeparationError({
          code: "cloud_cancelled",
          summary: "The cloud separation was cancelled.",
        })
      }

      let job: RunPodJob
      try {
        job = await this.client.status(jobId)
      } catch (error) {
        throw new CloudSeparationError({
          code: "cloud_status_failed",
          summary: "Lost contact with the cloud separation job.",
          detail: redactSecrets(error instanceof Error ? error.message : String(error)),
        })
      }

      if (job.status !== lastStatus) {
        lastStatus = job.status
        hooks.onStage?.(describeStatus(job.status))
      }
      await hooks.onStatus?.(job.status, { polledAt: new Date(this.now()) })

      // Real counters when the worker reports them; nothing invented when not.
      const progress = readLatestProgress(job)
      if (progress) hooks.onProgress?.(progress)

      if (isTerminalStatus(job.status)) {
        if (isFailureStatus(job.status)) {
          throw new CloudSeparationError({
            code: `cloud_${job.status.toLowerCase()}`,
            summary: summariseFailure(job.status),
            detail: redactSecrets(
              typeof job.error === "string" ? job.error : JSON.stringify(job.error ?? {}),
            ),
          })
        }
        return job
      }

      if (this.now() > deadline) {
        throw new CloudSeparationError({
          code: "cloud_wait_timeout",
          summary: "The cloud separation did not finish in time.",
          detail: `last status ${job.status}`,
        })
      }

      await this.sleep(withJitter(interval))
      interval = Math.min(Math.round(interval * POLL_GROWTH), MAX_POLL_MS)
    }
  }

  private async download(
    request: CloudSeparationRequest,
    prefix: string,
    job: RunPodJob,
  ): Promise<AudioStems> {
    const output = (job.output ?? {}) as { dialogue_key?: string; background_key?: string }
    const dialoguePath = path.join(request.workDir, "cloud-dialogue.wav")
    const backgroundPath = path.join(request.workDir, "cloud-background.wav")

    try {
      await this.storage.downloadOutput(
        output.dialogue_key ?? dialogueKey(request.correlationId),
        dialoguePath,
      )
      await this.storage.downloadOutput(
        output.background_key ?? backgroundKey(request.correlationId),
        backgroundPath,
      )
    } catch (error) {
      throw new CloudSeparationError({
        code: "cloud_download_failed",
        summary: "The separated audio could not be downloaded.",
        detail: redactSecrets(error instanceof Error ? error.message : String(error)),
      })
    }

    void prefix
    return { dialoguePath, backgroundPath, strategy: "separated" }
  }
}

/**
 * The newest progress reading in a job payload.
 *
 * RunPod accumulates worker updates, so the last recognisable one is the
 * current state. Anything unrecognised is ignored rather than guessed at.
 */
export function readLatestProgress(job: RunPodJob): SeparationProgress | null {
  const entries = Array.isArray(job.stream) ? job.stream : []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const raw = entries[index]
    const payload =
      typeof raw === "string"
        ? safeParse(raw)
        : ((raw as { output?: unknown })?.output ?? raw)
    const reading = readWorkerProgress(typeof payload === "string" ? safeParse(payload) : payload)
    if (reading) return reading
  }
  return null
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** Provider states, in words a reader recognises from the local path. */
export function describeStatus(status: string): string {
  switch (status) {
    case "IN_QUEUE":
      return "Queued for GPU"
    case "IN_PROGRESS":
      return "Separating dialogue on GPU"
    case "COMPLETED":
      return "Downloading separated audio"
    default:
      // An unfamiliar state is reported, never assumed to be success.
      return `Cloud separation: ${status.toLowerCase().replace(/_/g, " ")}`
  }
}

function summariseFailure(status: string): string {
  switch (status) {
    case "CANCELLED":
      return "The cloud separation was cancelled."
    case "TIMED_OUT":
      return "The cloud separation timed out before a worker finished it."
    default:
      return "Cloud audio separation failed."
  }
}

/** ±20%, so concurrent jobs do not poll in lockstep. */
function withJitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.4))
}
