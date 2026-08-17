import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CloudSeparationError,
  RunPodSeparationProvider,
  describeStatus,
  readLatestProgress,
} from "../packages/media-ai/src/runpod-separation-provider"

/**
 * Buying a GPU separation exactly once.
 *
 * BullMQ is at-least-once: a crash, a stall, a restart or a retry re-enters the
 * processor, and the obvious response to re-entry is to submit again — a second
 * paid job for work already running or already finished. Most of this file is
 * about that, and every test counts `/run` calls explicitly rather than
 * inferring cost from how the code reads.
 *
 * Persistence is injected, so every recovery path — crash before submit, after
 * submit, after completion, after cache commit — is reachable here without a
 * database, a provider, or a wait.
 */

let work: string

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "arciin-cloud-provider-"))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

const HEALTHY_OUTPUT = {
  dialogue_key: "cloud/jobs/corr-1/dialogue.wav",
  background_key: "cloud/jobs/corr-1/background.wav",
}

/** A provider whose every collaborator is observable. */
function build(options: {
  statuses?: string[]
  output?: unknown
  error?: unknown
  uploadFails?: boolean
  downloadFails?: boolean
  storedJobId?: string | null
} = {}) {
  const statuses = options.statuses ?? ["COMPLETED"]
  let statusIndex = 0

  const submit = vi.fn(async () => ({ id: "runpod-job-1", status: "IN_QUEUE" }))
  const status = vi.fn(async () => {
    const next = statuses[Math.min(statusIndex, statuses.length - 1)]!
    statusIndex += 1
    return {
      id: "runpod-job-1",
      status: next,
      ...(next === "COMPLETED" ? { output: options.output ?? HEALTHY_OUTPUT } : {}),
      ...(options.error ? { error: options.error } : {}),
    }
  })
  const cancel = vi.fn(async () => ({ id: "runpod-job-1", status: "CANCELLED" }))

  const uploadInput = vi.fn(async (localPath: string, key: string) => {
    if (options.uploadFails) throw new Error("upload exploded")
    return { key, bytes: 1024, seconds: 0.1 }
  })
  const downloadOutput = vi.fn(async (key: string, localPath: string) => {
    if (options.downloadFails) throw new Error("download exploded")
    await writeFile(localPath, Buffer.alloc(2048, 1))
    return { path: localPath, bytes: 2048, seconds: 0.1 }
  })
  const deleteJobObjects = vi.fn(async () => ({ deleted: 3 }))

  let storedJobId: string | null = options.storedJobId ?? null
  const saveJobId = vi.fn(async (id: string) => {
    storedJobId = id
  })

  const hooks = {
    loadJobId: async () => storedJobId,
    saveJobId,
    onStatus: vi.fn(async () => {}),
    onStage: vi.fn(),
    onProgress: vi.fn(),
    onCleanupPending: vi.fn(async () => {}),
  }

  const provider = new RunPodSeparationProvider(
    { submit, status, cancel } as never,
    { uploadInput, downloadOutput, deleteJobObjects, testConnection: async () => ({ ok: true as const }) } as never,
    // No real waiting: the sequence is under test, not the clock.
    async () => {},
  )

  return {
    provider,
    submit,
    status,
    cancel,
    uploadInput,
    downloadOutput,
    deleteJobObjects,
    saveJobId,
    hooks,
    get storedJobId() {
      return storedJobId
    },
  }
}

const request = (over: Record<string, unknown> = {}) => ({
  inputPath: "/tmp/source.wav",
  workDir: work,
  correlationId: "corr-1",
  model: "htdemucs.yaml",
  ...over,
})

describe("the happy path", () => {
  it("uploads, submits once, waits, and returns stems", async () => {
    const rig = build({ statuses: ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"] })
    const stems = await rig.provider.separate(request(), rig.hooks)

    expect(rig.submit).toHaveBeenCalledTimes(1)
    expect(stems.strategy).toBe("separated")
    expect(stems.dialoguePath).toContain(work)
    expect(rig.downloadOutput).toHaveBeenCalledTimes(2)
  })

  it("persists the job id before it starts polling", async () => {
    /**
     * The window that matters. Between the provider accepting a paid job and
     * the id being written, a crash loses that job — and the retry buys another.
     */
    const rig = build()
    const order: string[] = []
    rig.saveJobId.mockImplementation(async () => {
      order.push("saved")
    })
    rig.status.mockImplementation(async () => {
      order.push("polled")
      return { id: "runpod-job-1", status: "COMPLETED", output: HEALTHY_OUTPUT }
    })

    await rig.provider.separate(request(), rig.hooks)
    expect(order[0]).toBe("saved")
  })

  it("sends keys, never media", async () => {
    const rig = build()
    await rig.provider.separate(request(), rig.hooks)

    const payload = rig.submit.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.input_key).toBe("cloud/jobs/corr-1/source.wav")
    expect(payload.output_prefix).toBe("cloud/jobs/corr-1")
    // A WAV in a JSON body is the thing the storage layer exists to avoid.
    expect(JSON.stringify(payload).length).toBeLessThan(300)
  })

  it("refuses to upload anything that is not extracted audio", async () => {
    /**
     * Separation needs a waveform, not frames. Uploading the container because
     * it happens to be on disk would send the user's video to a third party at
     * several times the size and for no benefit.
     */
    const rig = build()
    const error = (await rig.provider
      .separate(request({ inputPath: "/tmp/original.mp4" }), rig.hooks)
      .catch((e: unknown) => e)) as CloudSeparationError

    expect(error).toBeInstanceOf(CloudSeparationError)
    expect(error.code).toBe("cloud_input_invalid")
    expect(rig.uploadInput).not.toHaveBeenCalled()
    expect(rig.submit).not.toHaveBeenCalled()
  })

  it("records the remote objects for cleanup rather than deleting them itself", async () => {
    // The caller commits the cache first, so a cleanup failure can never cost
    // it the stems it has just paid for.
    const rig = build()
    await rig.provider.separate(request(), rig.hooks)

    expect(rig.hooks.onCleanupPending).toHaveBeenCalledWith("cloud/jobs/corr-1")
    expect(rig.deleteJobObjects).not.toHaveBeenCalled()
  })
})

describe("cost safety", () => {
  it("does not submit again when an id already exists", async () => {
    /**
     * The recovery that makes at-least-once delivery affordable. This is a
     * worker re-entering after a crash: the job is already queued or running,
     * and submitting again would buy a duplicate.
     */
    const rig = build({ storedJobId: "runpod-job-1" })
    await rig.provider.separate(request(), rig.hooks)

    expect(rig.submit).toHaveBeenCalledTimes(0)
    expect(rig.uploadInput, "nor upload the audio a second time").toHaveBeenCalledTimes(0)
    expect(rig.status).toHaveBeenCalled()
  })

  it("recovers a job that completed while the worker was gone", async () => {
    // RunPod finished; Arciin died before downloading. The retry must collect
    // the result, not commission it again.
    const rig = build({ storedJobId: "runpod-job-1", statuses: ["COMPLETED"] })
    const stems = await rig.provider.separate(request(), rig.hooks)

    expect(rig.submit).toHaveBeenCalledTimes(0)
    expect(stems.dialoguePath).toContain(work)
    expect(rig.downloadOutput).toHaveBeenCalledTimes(2)
  })

  it("submits exactly once across three consecutive executions", async () => {
    const rig = build({ statuses: ["IN_QUEUE", "COMPLETED"] })
    await rig.provider.separate(request(), rig.hooks)
    await rig.provider.separate(request(), rig.hooks)
    await rig.provider.separate(request(), rig.hooks)

    // Whatever re-entered the processor — a retry, a restart, a stall — the
    // paid submission happened once.
    expect(rig.submit).toHaveBeenCalledTimes(1)
  })

  it("reuses one prefix, so a retry does not upload a second copy", async () => {
    const rig = build()
    await rig.provider.separate(request(), rig.hooks)
    expect(rig.uploadInput.mock.calls[0]![1]).toBe("cloud/jobs/corr-1/source.wav")
  })
})

describe("provider states", () => {
  it("waits through queued and running", async () => {
    const rig = build({ statuses: ["IN_QUEUE", "IN_QUEUE", "IN_PROGRESS", "COMPLETED"] })
    await rig.provider.separate(request(), rig.hooks)

    const stages = rig.hooks.onStage.mock.calls.map((c) => c[0])
    expect(stages).toContain("Queued for GPU")
    expect(stages).toContain("Separating dialogue on GPU")
  })

  for (const status of ["FAILED", "CANCELLED", "TIMED_OUT"]) {
    it(`treats ${status} as a failure, not a result`, async () => {
      const rig = build({ statuses: [status] })
      const error = (await rig.provider
        .separate(request(), rig.hooks)
        .catch((e: unknown) => e)) as CloudSeparationError

      expect(error).toBeInstanceOf(CloudSeparationError)
      expect(error.code).toBe(`cloud_${status.toLowerCase()}`)
      // Nothing was downloaded, because nothing was produced.
      expect(rig.downloadOutput).not.toHaveBeenCalled()
    })
  }

  it("does not mistake an unknown future state for success", async () => {
    /**
     * A state this code has never heard of is not a result. Treating it as one
     * would send the pipeline looking for stems that were never written.
     */
    const rig = build({ statuses: ["SOMETHING_NEW", "COMPLETED"] })
    await rig.provider.separate(request(), rig.hooks)
    expect(rig.status.mock.calls.length).toBeGreaterThan(1)
  })

  it("keeps provider errors free of credentials", async () => {
    const rig = build({
      statuses: ["FAILED"],
      error: 'auth failed for rpa_secret_key and rps_secret_storage',
    })
    const error = (await rig.provider
      .separate(request(), rig.hooks)
      .catch((e: unknown) => e)) as CloudSeparationError

    // The detail is stored and rendered behind a disclosure.
    expect(error.detail).not.toContain("rpa_secret_key")
    expect(error.detail).not.toContain("rps_secret_storage")
  })
})

describe("cancellation", () => {
  it("cancels the paid job when the caller aborts", async () => {
    const controller = new AbortController()
    controller.abort()

    const rig = build({ storedJobId: "runpod-job-1" })
    const error = (await rig.provider
      .separate(request({ signal: controller.signal }), rig.hooks)
      .catch((e: unknown) => e)) as CloudSeparationError

    expect(error.code).toBe("cloud_cancelled")
    // Stopped rather than abandoned to run to completion unwatched, and its
    // remote files removed.
    expect(rig.cancel).toHaveBeenCalledWith("runpod-job-1")
    expect(rig.deleteJobObjects).toHaveBeenCalled()
  })

  it("cleans up remote objects on an explicit cancel", async () => {
    const rig = build()
    await rig.provider.cancel("runpod-job-1", "corr-1")

    expect(rig.cancel).toHaveBeenCalledWith("runpod-job-1")
    expect(rig.deleteJobObjects).toHaveBeenCalledWith("cloud/jobs/corr-1")
  })

  it("survives a provider that refuses the cancel", async () => {
    // The remote files still have to go, whatever the control plane says.
    const rig = build()
    rig.cancel.mockRejectedValueOnce(new Error("already finished"))
    await rig.provider.cancel("runpod-job-1", "corr-1")
    expect(rig.deleteJobObjects).toHaveBeenCalled()
  })
})

describe("transfer failures", () => {
  it("does not submit a paid job when the upload fails", async () => {
    const rig = build({ uploadFails: true })
    const error = (await rig.provider
      .separate(request(), rig.hooks)
      .catch((e: unknown) => e)) as CloudSeparationError

    expect(error.code).toBe("cloud_upload_failed")
    // Nothing to separate means nothing to pay for.
    expect(rig.submit).not.toHaveBeenCalled()
  })

  it("reports a download failure without discarding the job id", async () => {
    const rig = build({ downloadFails: true })
    const error = (await rig.provider
      .separate(request(), rig.hooks)
      .catch((e: unknown) => e)) as CloudSeparationError

    expect(error.code).toBe("cloud_download_failed")
    // The id survives, so a retry collects the finished result rather than
    // buying it again.
    expect(rig.storedJobId).toBe("runpod-job-1")
  })
})

describe("progress", () => {
  it("reads the newest worker reading", () => {
    const job = {
      id: "x",
      status: "IN_PROGRESS",
      stream: [
        JSON.stringify({ stage: "separating", current: 10, total: 122 }),
        JSON.stringify({ stage: "separating", current: 39, total: 122 }),
      ],
    }
    expect(readLatestProgress(job)).toEqual({ completed: 39, total: 122, percent: 32 })
  })

  it("unwraps the shape RunPod nests updates in", () => {
    const job = {
      id: "x",
      status: "IN_PROGRESS",
      stream: [{ output: { stage: "separating", current: 61, total: 122 } }],
    }
    expect(readLatestProgress(job)?.percent).toBe(50)
  })

  it("reports nothing rather than guessing", () => {
    // A fabricated percentage is worse than none — the same rule the local
    // path follows.
    expect(readLatestProgress({ id: "x", status: "IN_PROGRESS" })).toBeNull()
    expect(readLatestProgress({ id: "x", status: "IN_PROGRESS", stream: ["hello"] })).toBeNull()
  })
})

describe("describeStatus", () => {
  it("uses the same words the local path uses", () => {
    expect(describeStatus("IN_QUEUE")).toBe("Queued for GPU")
    expect(describeStatus("IN_PROGRESS")).toBe("Separating dialogue on GPU")
  })

  it("names an unfamiliar state instead of inventing one", () => {
    expect(describeStatus("SOMETHING_NEW")).toContain("something new")
  })
})
