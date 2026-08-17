import { fetchApi } from "@/lib/api/client"

/**
 * Where audio separation runs, and how RunPod is connected.
 *
 * Nothing here ever carries a secret. The server has no read path that returns
 * one — the only function that decrypts is the one the worker calls — so these
 * types describe the whole of what a browser can know about the connection.
 */

export type SeparationMode = "auto" | "local" | "cloud"

export type LocalSeparationInfo = {
  available: boolean
  engine: string
  implementation: string
  compute: string
}

export type RunPodTestSummary = {
  ok: boolean
  at: string
  gpuName?: string | null
  cudaAvailable?: boolean | null
  separatorVersion?: string | null
  model?: string | null
}

export type RunPodStatus = {
  configured: boolean
  /** `abc…xyz` — enough to recognise, never enough to use. */
  endpointDisplay: string | null
  volumeDisplay: string | null
  datacenter: string | null
  connectedAt: string | null
  lastTest: RunPodTestSummary | null
}

export type AudioSeparationSettings = {
  local: LocalSeparationInfo
  runpod: RunPodStatus
  mode: SeparationMode
}

/** One row of the connection test. */
export type ConnectionLayerResult = {
  layer: "api" | "endpoint" | "storage" | "gpu" | "model"
  label: string
  ok: boolean
  detail?: string
  reason?: string
}

export type ConnectionTestResult = {
  ok: boolean
  layers: ConnectionLayerResult[]
  gpuName?: string | null
  cudaAvailable?: boolean | null
  separatorVersion?: string | null
  model?: string | null
}

/**
 * The connection form.
 *
 * Two unrelated credentials: the API key drives the Serverless endpoint, and
 * the network volume speaks S3 with a separate key pair generated in the RunPod
 * console. Confusing the two is the likeliest setup mistake, which is why they
 * are asked for separately and reported on separately.
 */
export type RunPodConnectionInput = {
  apiKey: string
  endpointId: string
  volumeId: string
  datacenter: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
}

export function getAudioSeparationSettings(signal?: AbortSignal) {
  return fetchApi<AudioSeparationSettings>("/settings/audio-separation", { signal })
}

/** Sent once. The server encrypts it and never sends it back. */
export function saveRunPodConnection(input: RunPodConnectionInput) {
  return fetchApi<RunPodStatus>("/settings/audio-separation/runpod", {
    method: "PUT",
    body: input,
  })
}

export function testRunPodConnection() {
  return fetchApi<ConnectionTestResult>("/settings/audio-separation/runpod/test", {
    method: "POST",
  })
}

/** Removes the credentials only — dubs, cached stems and media all survive. */
export function disconnectRunPod() {
  return fetchApi<RunPodStatus>("/settings/audio-separation/runpod", { method: "DELETE" })
}

export function setSeparationMode(mode: SeparationMode) {
  return fetchApi<{ mode: SeparationMode }>("/settings/audio-separation/mode", {
    method: "PATCH",
    body: { mode },
  })
}
