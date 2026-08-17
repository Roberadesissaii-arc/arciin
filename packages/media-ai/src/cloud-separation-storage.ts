import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import type { Readable } from "node:stream"

import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"

/**
 * Getting audio to a cloud separator and stems back, without holding either in
 * memory.
 *
 * A twelve-minute WAV is about 125 MB and a feature-length one is far more.
 * Base64 in a JSON request body would be roughly a third larger again, slow to
 * encode, and would sit in the heap of a worker that has 7 GB to share with
 * everything else — so transfer goes through object storage and the job payload
 * carries keys.
 *
 * RunPod's network volumes speak an S3-compatible API per datacenter, and the
 * same volume is mounted inside the serverless worker at `/runpod-volume`. So a
 * key written here is a path the GPU can simply open: no second transfer, no
 * signed URL for the worker to fetch.
 *
 * Deliberately an interface first. RunPod is the first cloud provider, not the
 * intended only one, and everything downstream of `dialogue` and `background`
 * must not know which of them produced the files.
 */

export type CloudSeparationCredentials = {
  /** `https://s3api-eu-cz-1.runpod.io`, and so on per datacenter. */
  endpoint: string
  region: string
  /** The bucket *is* the network volume id. */
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export type UploadResult = {
  key: string
  bytes: number
  seconds: number
}

export type DownloadResult = {
  path: string
  bytes: number
  seconds: number
}

export interface CloudSeparationStorage {
  /** Proves the credentials work *and* that the bucket is reachable. */
  testConnection(): Promise<{ ok: true } | { ok: false; reason: string }>
  uploadInput(localPath: string, key: string): Promise<UploadResult>
  downloadOutput(key: string, localPath: string): Promise<DownloadResult>
  /** Everything under one job's prefix, whatever the outcome. */
  deleteJobObjects(prefix: string): Promise<{ deleted: number }>
}

export class CloudStorageError extends Error {
  readonly reason: string
  constructor(message: string, reason: string) {
    super(message)
    this.name = "CloudStorageError"
    this.reason = reason
  }
}

/**
 * Parts are 16 MB.
 *
 * Large enough that a 125 MB upload is eight requests rather than a hundred,
 * small enough that a retry after a network blip re-sends megabytes and not the
 * whole file. `lib-storage` streams each part, so peak memory is a few parts —
 * not the file.
 */
const PART_SIZE = 16 * 1024 * 1024
const QUEUE_SIZE = 3

export class S3CloudSeparationStorage implements CloudSeparationStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(credentials: CloudSeparationCredentials, clientOverride?: S3Client) {
    this.bucket = credentials.bucket
    this.client =
      clientOverride ??
      new S3Client({
        endpoint: credentials.endpoint,
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
        // Volume ids are not DNS-safe as subdomains.
        forcePathStyle: true,
      })
  }

  async testConnection(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: describeStorageFailure(error) }
    }
  }

  /**
   * Stream a local file up.
   *
   * `createReadStream` rather than `readFile`: the point of this class is that
   * the media never lands in the heap, and one `Buffer` here would undo it.
   */
  async uploadInput(localPath: string, key: string): Promise<UploadResult> {
    const started = Date.now()
    const info = await stat(localPath)

    try {
      const upload = new Upload({
        client: this.client,
        params: buildUploadParams(this.bucket, key, localPath),
        partSize: PART_SIZE,
        queueSize: QUEUE_SIZE,
        // A failed multipart upload otherwise leaves its parts behind, billed
        // and invisible.
        leavePartsOnError: false,
      })
      await upload.done()
    } catch (error) {
      throw new CloudStorageError(
        `Could not upload the source audio for separation. ${describeStorageFailure(error)}`,
        "upload_failed",
      )
    }

    return { key, bytes: info.size, seconds: (Date.now() - started) / 1000 }
  }

  /** Stream a produced stem down, straight to disk. */
  async downloadOutput(key: string, localPath: string): Promise<DownloadResult> {
    const started = Date.now()
    await mkdir(path.dirname(localPath), { recursive: true })

    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )
      if (!response.Body) {
        throw new CloudStorageError(`The separator produced no data at ${key}.`, "empty_output")
      }
      await pipeline(response.Body as Readable, createWriteStream(localPath))
    } catch (error) {
      if (error instanceof CloudStorageError) throw error
      throw new CloudStorageError(
        `Could not download the separated audio. ${describeStorageFailure(error)}`,
        "download_failed",
      )
    }

    const info = await stat(localPath)
    if (info.size === 0) {
      // A zero-byte stem would be mixed in silently and produce a dub quietly
      // missing its music, so it is a failure here rather than downstream.
      throw new CloudStorageError(`The separated audio at ${key} was empty.`, "empty_output")
    }

    return { path: localPath, bytes: info.size, seconds: (Date.now() - started) / 1000 }
  }

  /**
   * Remove everything a job left behind.
   *
   * Listed then deleted in batches, because the caller knows a prefix and not
   * the individual keys — and a partial listing must not be mistaken for "all
   * gone", which is why this pages to the end.
   */
  async deleteJobObjects(prefix: string): Promise<{ deleted: number }> {
    let deleted = 0
    let token: string | undefined

    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )
      const keys = (listed.Contents ?? []).map((entry) => ({ Key: entry.Key! })).filter((e) => e.Key)
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }),
        )
        deleted += keys.length
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined
    } while (token)

    return { deleted }
  }
}

/**
 * What gets handed to the uploader.
 *
 * Extracted so the one property that matters can be asserted directly: the body
 * is a stream, not a Buffer. Emulating the SDK's multipart internals in a test
 * would prove far less and break on every upgrade.
 */
export function buildUploadParams(bucket: string, key: string, localPath: string) {
  return { Bucket: bucket, Key: key, Body: createReadStream(localPath) }
}

/**
 * Storage failures, in terms of the thing a reader can fix.
 *
 * This feature needs two unrelated RunPod credentials and a volume in a
 * specific datacenter; "AccessDenied" alone does not say which of those is
 * wrong.
 */
export function describeStorageFailure(error: unknown): string {
  const name = (error as { name?: string })?.name ?? ""
  const code = (error as { Code?: string })?.Code ?? ""
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode

  if (name === "NoSuchBucket" || code === "NoSuchBucket" || status === 404) {
    return "The network volume was not found. Check the volume ID and that its datacenter matches the endpoint."
  }
  if (name === "AccessDenied" || code === "AccessDenied" || status === 403) {
    return "The storage credentials were rejected. Note that the S3 API key is separate from the RunPod API key."
  }
  if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || status === 401) {
    return "The S3 access key or secret is not valid for this datacenter."
  }
  if (name === "TimeoutError" || name === "AbortError") {
    return "The storage request timed out."
  }
  return "The storage request failed."
}

/**
 * Where one job's files live.
 *
 * A correlation id rather than the dub id, because a retry of the same
 * separation should reuse the same prefix — that is what stops a restart
 * uploading a second copy of the audio beside the first.
 */
export function jobPrefix(correlationId: string): string {
  return `cloud/jobs/${correlationId}`
}

export function sourceKey(correlationId: string): string {
  return `${jobPrefix(correlationId)}/source.wav`
}

export function dialogueKey(correlationId: string): string {
  return `${jobPrefix(correlationId)}/dialogue.wav`
}

export function backgroundKey(correlationId: string): string {
  return `${jobPrefix(correlationId)}/background.wav`
}
