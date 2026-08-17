import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CloudStorageError,
  S3CloudSeparationStorage,
  buildUploadParams,
  backgroundKey,
  describeStorageFailure,
  dialogueKey,
  jobPrefix,
  sourceKey,
} from "../packages/media-ai/src/cloud-separation-storage"

/**
 * Moving audio to a cloud separator and stems back.
 *
 * The S3 client is stubbed at the `send` boundary — what matters here is not
 * that the AWS SDK works, but that this code never holds media in memory, never
 * mistakes a partial listing for a complete cleanup, and refuses a zero-byte
 * stem rather than passing it downstream to be mixed into silence.
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "arciin-cloud-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const CREDENTIALS = {
  endpoint: "https://s3api-eu-cz-1.runpod.io",
  region: "eu-cz-1",
  bucket: "vol-abc123",
  accessKeyId: "user_test",
  secretAccessKey: "rps_test",
}

/** A stand-in S3 client that records commands and answers from a script. */
function fakeClient(handler: (command: unknown) => unknown) {
  const sent: unknown[] = []
  return {
    sent,
    client: {
      send: vi.fn(async (command: unknown) => {
        sent.push(command)
        return handler(command)
      }),
    } as never,
  }
}

const commandName = (command: unknown) => (command as { constructor: { name: string } }).constructor.name

describe("key layout", () => {
  it("puts one job's files under one prefix", () => {
    expect(sourceKey("corr-1")).toBe("cloud/jobs/corr-1/source.wav")
    expect(dialogueKey("corr-1")).toBe("cloud/jobs/corr-1/dialogue.wav")
    expect(backgroundKey("corr-1")).toBe("cloud/jobs/corr-1/background.wav")
    expect(sourceKey("corr-1").startsWith(jobPrefix("corr-1"))).toBe(true)
  })

  it("gives the same job the same prefix every time", () => {
    /**
     * Keyed on a correlation id rather than an attempt, so a retry reuses the
     * same location instead of uploading a second copy of the audio beside the
     * first and paying to store both.
     */
    expect(jobPrefix("corr-1")).toBe(jobPrefix("corr-1"))
    expect(jobPrefix("corr-2")).not.toBe(jobPrefix("corr-1"))
  })
})

describe("testConnection", () => {
  it("passes when the bucket is reachable", async () => {
    const { client } = fakeClient(() => ({}))
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)
    expect(await storage.testConnection()).toEqual({ ok: true })
  })

  it("says which credential is wrong rather than just failing", async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied" })
    })
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)
    const result = await storage.testConnection()

    expect(result.ok).toBe(false)
    // Two unrelated RunPod credentials are needed here, and using one where the
    // other belongs is the likeliest mistake.
    expect((result as { reason: string }).reason).toMatch(/separate from the RunPod API key/i)
  })

  it("distinguishes a missing volume from a rejected key", async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error("nope"), { name: "NoSuchBucket" })
    })
    const result = await new S3CloudSeparationStorage(CREDENTIALS, client).testConnection()
    expect((result as { reason: string }).reason).toMatch(/datacenter matches/i)
  })
})

describe("uploadInput", () => {
  it("hands the uploader a stream, never a buffer", async () => {
    const source = path.join(root, "source.wav")
    await writeFile(source, Buffer.alloc(64 * 1024, 7))

    const params = buildUploadParams("vol-abc123", "cloud/jobs/x/source.wav", source)

    /**
     * The property this whole class exists for. A 12-minute WAV is 125 MB and a
     * feature-length one far more; one Buffer here would put all of it in the
     * heap of a worker that shares 7 GB with everything else.
     */
    expect(Buffer.isBuffer(params.Body), "media must not be buffered whole").toBe(false)
    expect(typeof (params.Body as { pipe?: unknown }).pipe).toBe("function")
    expect(params.Bucket).toBe("vol-abc123")
    expect(params.Key).toBe("cloud/jobs/x/source.wav")
    ;(params.Body as { destroy: () => void }).destroy()
  })

  it("reports an upload failure in terms of what broke", async () => {
    const source = path.join(root, "source.wav")
    await writeFile(source, Buffer.alloc(1024))

    const { client } = fakeClient(() => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied" })
    })
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)

    const error = (await storage
      .uploadInput(source, "k")
      .catch((e: unknown) => e)) as CloudStorageError

    /**
     * Only the classification is asserted here. The uploader wraps whatever the
     * transport threw before this code sees it, so the credential-specific
     * wording cannot be provoked through this path — that mapping is covered
     * directly in the `describeStorageFailure` tests and through
     * `testConnection`, which does see the raw error.
     */
    expect(error).toBeInstanceOf(CloudStorageError)
    expect(error.reason).toBe("upload_failed")
    expect(error.message).toMatch(/Could not upload the source audio/i)
  })
})

describe("downloadOutput", () => {
  it("streams a stem straight to disk", async () => {
    const payload = Buffer.alloc(32 * 1024, 3)
    const { client } = fakeClient(() => ({ Body: Readable.from([payload]) }))
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)

    const target = path.join(root, "stems", "dialogue.wav")
    const result = await storage.downloadOutput("cloud/jobs/x/dialogue.wav", target)

    expect(result.bytes).toBe(payload.length)
    expect((await readFile(target)).length).toBe(payload.length)
  })

  it("refuses an empty stem instead of passing it downstream", async () => {
    /**
     * A zero-byte background track would be mixed in silently, and the dub
     * would be quietly missing its music — noticed only by someone listening.
     */
    const { client } = fakeClient(() => ({ Body: Readable.from([Buffer.alloc(0)]) }))
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)

    const error = (await storage
      .downloadOutput("k", path.join(root, "empty.wav"))
      .catch((e: unknown) => e)) as CloudStorageError

    expect(error).toBeInstanceOf(CloudStorageError)
    expect(error.reason).toBe("empty_output")
  })

  it("refuses a response with no body at all", async () => {
    const { client } = fakeClient(() => ({}))
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)
    const error = (await storage
      .downloadOutput("k", path.join(root, "missing.wav"))
      .catch((e: unknown) => e)) as CloudStorageError
    expect(error.reason).toBe("empty_output")
  })

  it("creates the directory it is asked to write into", async () => {
    const { client } = fakeClient(() => ({ Body: Readable.from([Buffer.alloc(16, 1)]) }))
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)

    const nested = path.join(root, "a", "b", "c", "background.wav")
    await storage.downloadOutput("k", nested)
    expect((await stat(nested)).size).toBe(16)
  })

  it("survives an interrupted download by failing, not by half-writing a hit", async () => {
    const broken = new Readable({
      read() {
        this.destroy(new Error("connection reset"))
      },
    })
    const { client } = fakeClient(() => ({ Body: broken }))
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)

    const error = (await storage
      .downloadOutput("k", path.join(root, "partial.wav"))
      .catch((e: unknown) => e)) as CloudStorageError
    expect(error).toBeInstanceOf(CloudStorageError)
    expect(error.reason).toBe("download_failed")
  })
})

describe("deleteJobObjects", () => {
  it("removes everything under a job's prefix", async () => {
    const { client, sent } = fakeClient((command) => {
      if (commandName(command) === "ListObjectsV2Command") {
        return { Contents: [{ Key: "cloud/jobs/x/source.wav" }, { Key: "cloud/jobs/x/dialogue.wav" }] }
      }
      return {}
    })
    const storage = new S3CloudSeparationStorage(CREDENTIALS, client)

    const result = await storage.deleteJobObjects("cloud/jobs/x")
    expect(result.deleted).toBe(2)
    expect(sent.some((c) => commandName(c) === "DeleteObjectsCommand")).toBe(true)
  })

  it("pages to the end rather than calling a partial listing done", async () => {
    /**
     * A truncated listing treated as complete leaves a user's source audio on
     * someone else's storage indefinitely, which is the failure that actually
     * matters here.
     */
    let page = 0
    const { client } = fakeClient((command) => {
      if (commandName(command) === "ListObjectsV2Command") {
        page += 1
        if (page === 1) {
          return {
            Contents: [{ Key: "a" }],
            IsTruncated: true,
            NextContinuationToken: "token-2",
          }
        }
        return { Contents: [{ Key: "b" }], IsTruncated: false }
      }
      return {}
    })

    const result = await new S3CloudSeparationStorage(CREDENTIALS, client).deleteJobObjects("p")
    expect(result.deleted).toBe(2)
    expect(page).toBe(2)
  })

  it("is content with nothing to delete", async () => {
    const { client } = fakeClient(() => ({ Contents: [] }))
    const result = await new S3CloudSeparationStorage(CREDENTIALS, client).deleteJobObjects("p")
    expect(result.deleted).toBe(0)
  })
})

describe("describeStorageFailure", () => {
  it("names the fixable cause where it can", () => {
    expect(describeStorageFailure({ name: "NoSuchBucket" })).toMatch(/volume ID/i)
    expect(describeStorageFailure({ name: "SignatureDoesNotMatch" })).toMatch(/not valid/i)
    expect(describeStorageFailure({ name: "TimeoutError" })).toMatch(/timed out/i)
  })

  it("stays vague rather than guessing when it does not know", () => {
    expect(describeStorageFailure(new Error("something odd"))).toBe("The storage request failed.")
  })
})
