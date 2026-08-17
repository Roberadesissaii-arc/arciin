import type { PrismaClient } from "@prisma/client"

import { decryptSecret, encryptSecret } from "@/services/security/encryption"

/**
 * The RunPod connection, stored so the browser never sees it again.
 *
 * Two unrelated credentials are needed, which is the single most confusing part
 * of setting this up: the RunPod API key drives the Serverless endpoint, while
 * the network volume speaks S3 with a *separate* key pair generated in the
 * console. They are stored and reported separately for that reason — a failure
 * has to be able to say which one was rejected.
 *
 * Secrets are encrypted with the same AES-256-GCM helper the rest of the
 * instance uses, and the read path deliberately has no way to return them: the
 * only function that decrypts is the one the worker calls, and everything the
 * browser can reach goes through `describeConnection`.
 */

/**
 * Always the same row.
 *
 * There should be exactly one InstanceConfig, but nothing enforces that, and an
 * unordered `findFirst` may return a *different* row after an update — Postgres
 * is free to move a row on write. That turned a read-modify-write into reading
 * one row and writing another, which showed up as a connection that saved
 * successfully and then read back as unconfigured.
 */
const INSTANCE_ROW = { orderBy: { createdAt: "asc" } } as const

export type RunPodConnectionInput = {
  apiKey: string
  endpointId: string
  /** The network volume id, which doubles as the S3 bucket. */
  volumeId: string
  /** `eu-cz-1`, `us-ca-2`, and so on. */
  datacenter: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
}

/** What the worker needs. Never leaves the server. */
export type RunPodCredentials = RunPodConnectionInput & {
  /** Derived from the datacenter rather than stored, so they cannot disagree. */
  s3Endpoint: string
}

/** What a browser is allowed to know. */
export type RunPodConnectionStatus = {
  configured: boolean
  /** `abc…xyz` — enough to recognise, not enough to use. */
  endpointDisplay: string | null
  volumeDisplay: string | null
  datacenter: string | null
  connectedAt: string | null
  /** From the last connection test, if one has run. */
  lastTest: RunPodTestSummary | null
}

export type RunPodTestSummary = {
  ok: boolean
  at: string
  gpuName?: string | null
  cudaAvailable?: boolean | null
  separatorVersion?: string | null
  model?: string | null
}

type StoredRunPod = {
  endpointId: string
  volumeId: string
  datacenter: string
  s3AccessKeyId: string
  /** Ciphertext. */
  apiKey: string
  /** Ciphertext. */
  s3SecretAccessKey: string
  connectedAt: string
  lastTest?: RunPodTestSummary
}

/**
 * The S3 host for a datacenter.
 *
 * Derived rather than asked for: a volume lives in exactly one datacenter, and
 * letting someone type both invites the mismatch that produces a confusing
 * "bucket not found" against perfectly valid credentials.
 */
export function s3EndpointFor(datacenter: string): string {
  return `https://s3api-${datacenter.trim().toLowerCase()}.runpod.io`
}

/** `abc…xyz`, so a reader can tell two endpoints apart without exposing either. */
export function maskIdentifier(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}…`
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

function readStored(raw: unknown): StoredRunPod | null {
  if (!raw || typeof raw !== "object") return null
  const config = raw as Record<string, unknown>
  const runpod = config.runpod
  if (!runpod || typeof runpod !== "object") return null

  const entry = runpod as Record<string, unknown>
  const required = ["endpointId", "volumeId", "datacenter", "s3AccessKeyId", "apiKey", "s3SecretAccessKey"]
  for (const field of required) {
    if (typeof entry[field] !== "string" || !entry[field]) return null
  }

  return {
    endpointId: entry.endpointId as string,
    volumeId: entry.volumeId as string,
    datacenter: entry.datacenter as string,
    s3AccessKeyId: entry.s3AccessKeyId as string,
    apiKey: entry.apiKey as string,
    s3SecretAccessKey: entry.s3SecretAccessKey as string,
    connectedAt: (entry.connectedAt as string) ?? new Date().toISOString(),
    ...(entry.lastTest ? { lastTest: entry.lastTest as RunPodTestSummary } : {}),
  }
}

/**
 * Status for the browser.
 *
 * Everything here is safe to serialise into a page. There is deliberately no
 * variant of this that includes a secret, so no caller can reach for one by
 * mistake.
 */
export async function getRunPodStatus(prisma: PrismaClient): Promise<RunPodConnectionStatus> {
  const instance = await prisma.instanceConfig.findFirst({ ...INSTANCE_ROW, select: { dubbingConfig: true } })
  const stored = readStored(instance?.dubbingConfig)

  if (!stored) {
    return {
      configured: false,
      endpointDisplay: null,
      volumeDisplay: null,
      datacenter: null,
      connectedAt: null,
      lastTest: null,
    }
  }

  return {
    configured: true,
    endpointDisplay: maskIdentifier(stored.endpointId),
    volumeDisplay: maskIdentifier(stored.volumeId),
    datacenter: stored.datacenter,
    connectedAt: stored.connectedAt,
    lastTest: stored.lastTest ?? null,
  }
}

/**
 * The decrypted connection, for server-side use only.
 *
 * The one function that can produce a secret. Kept separate from the status
 * path so that "what does the browser get" and "what does the worker get" are
 * different questions with different answers, rather than one shape with a flag.
 */
export async function getRunPodCredentials(
  prisma: PrismaClient,
): Promise<RunPodCredentials | null> {
  const instance = await prisma.instanceConfig.findFirst({ ...INSTANCE_ROW, select: { dubbingConfig: true } })
  const stored = readStored(instance?.dubbingConfig)
  if (!stored) return null

  try {
    return {
      endpointId: stored.endpointId,
      volumeId: stored.volumeId,
      datacenter: stored.datacenter,
      s3AccessKeyId: stored.s3AccessKeyId,
      apiKey: decryptSecret(stored.apiKey),
      s3SecretAccessKey: decryptSecret(stored.s3SecretAccessKey),
      s3Endpoint: s3EndpointFor(stored.datacenter),
    }
  } catch {
    // A key rotation invalidates stored ciphertext. Treated as "not configured"
    // rather than crashing a dub, so the reader is asked to reconnect.
    return null
  }
}

export async function saveRunPodConnection(
  prisma: PrismaClient,
  input: RunPodConnectionInput,
): Promise<RunPodConnectionStatus> {
  const instance = await prisma.instanceConfig.findFirst({
    ...INSTANCE_ROW,
    select: { id: true, dubbingConfig: true },
  })
  if (!instance) throw new Error("This instance is not initialised.")

  const current =
    instance.dubbingConfig && typeof instance.dubbingConfig === "object"
      ? (instance.dubbingConfig as Record<string, unknown>)
      : {}

  const stored: StoredRunPod = {
    endpointId: input.endpointId.trim(),
    volumeId: input.volumeId.trim(),
    datacenter: input.datacenter.trim().toLowerCase(),
    s3AccessKeyId: input.s3AccessKeyId.trim(),
    // Only these two are secret. The access key id is an identifier, but it is
    // still not returned to the browser — there is no reason for it to be.
    apiKey: encryptSecret(input.apiKey.trim()),
    s3SecretAccessKey: encryptSecret(input.s3SecretAccessKey.trim()),
    connectedAt: new Date().toISOString(),
  }

  await prisma.instanceConfig.update({
    where: { id: instance.id },
    // Merged: the separation mode preference lives in the same object.
    data: { dubbingConfig: { ...current, runpod: stored } },
  })

  return getRunPodStatus(prisma)
}

/** Remember what the last test found, so the settings page can show it. */
export async function recordRunPodTest(
  prisma: PrismaClient,
  summary: RunPodTestSummary,
): Promise<void> {
  const instance = await prisma.instanceConfig.findFirst({
    ...INSTANCE_ROW,
    select: { id: true, dubbingConfig: true },
  })
  const stored = readStored(instance?.dubbingConfig)
  if (!instance || !stored) return

  const current = instance.dubbingConfig as Record<string, unknown>
  await prisma.instanceConfig.update({
    where: { id: instance.id },
    data: { dubbingConfig: { ...current, runpod: { ...stored, lastTest: summary } } },
  })
}

/**
 * Forget the connection.
 *
 * Removes the credentials and nothing else. Completed dubs, cached stems and
 * source media all survive — they are the user's work, and disconnecting a
 * provider is not a request to destroy anything that provider once helped
 * produce.
 */
export async function disconnectRunPod(prisma: PrismaClient): Promise<RunPodConnectionStatus> {
  const instance = await prisma.instanceConfig.findFirst({
    ...INSTANCE_ROW,
    select: { id: true, dubbingConfig: true },
  })
  if (!instance) return getRunPodStatus(prisma)

  const current =
    instance.dubbingConfig && typeof instance.dubbingConfig === "object"
      ? { ...(instance.dubbingConfig as Record<string, unknown>) }
      : {}
  delete current.runpod

  /**
   * Anything currently pointing at Cloud would now resolve to nothing, and an
   * explicit Cloud choice is never silently run locally — so the default drops
   * back to Auto rather than leaving a mode that can only fail.
   */
  if (current.separationMode === "cloud") current.separationMode = "auto"

  await prisma.instanceConfig.update({
    where: { id: instance.id },
    data: { dubbingConfig: current as object },
  })
  return getRunPodStatus(prisma)
}
