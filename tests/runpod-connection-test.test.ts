import { describe, expect, it, vi } from "vitest"

import {
  testRunPodConnection,
  type ConnectionLayer,
} from "../apps/api/src/services/dubbing/runpod-connection-test"

/**
 * Proving a RunPod connection works, layer by layer.
 *
 * The reason this is five checks rather than one: a valid API key against a
 * deleted endpoint, a valid endpoint whose volume lives in another datacenter,
 * and a perfectly healthy worker quietly running on CPU all look like success
 * if you only verify the key.
 *
 * That last case is the one worth the most care. A GPU endpoint that has fallen
 * back to CPU separates correctly and slowly while billing for a GPU — it is
 * indistinguishable from a working setup unless something asks, which is why a
 * real health job is submitted rather than trusting the control plane.
 */

const CREDENTIALS = {
  apiKey: "rpa_test",
  endpointId: "ep123",
  volumeId: "vol-abc",
  datacenter: "eu-cz-1",
  s3AccessKeyId: "user_x",
  s3SecretAccessKey: "rps_y",
  s3Endpoint: "https://s3api-eu-cz-1.runpod.io",
}

/** A worker output describing a healthy GPU box. */
const HEALTHY_OUTPUT = {
  ok: true,
  gpu: { cuda_available: true, gpu_name: "NVIDIA RTX A4000", cuda_version: "12.4" },
  separator: { implementation: "python-audio-separator", version: "0.44.5" },
  model: "htdemucs.yaml",
  separator_available: true,
  volume_mounted: true,
}

function deps(over: {
  health?: () => Promise<unknown>
  submit?: () => Promise<unknown>
  status?: () => Promise<unknown>
  storage?: () => Promise<{ ok: true } | { ok: false; reason: string }>
} = {}) {
  return {
    client: {
      health: over.health ?? (async () => ({ workers: { ready: 1 } })),
      submit: over.submit ?? (async () => ({ id: "job-1", status: "IN_QUEUE" })),
      status: over.status ?? (async () => ({ id: "job-1", status: "COMPLETED", output: HEALTHY_OUTPUT })),
    } as never,
    storage: {
      testConnection: over.storage ?? (async () => ({ ok: true as const })),
    } as never,
    // No real waiting: the sequence is what is under test, not the clock.
    sleep: async () => {},
  }
}

const layer = (result: { layers: { layer: ConnectionLayer; ok: boolean; reason?: string }[] }, name: ConnectionLayer) =>
  result.layers.find((l) => l.layer === name)!

describe("a healthy connection", () => {
  it("passes every layer and reports what it found", async () => {
    const result = await testRunPodConnection(CREDENTIALS, deps())

    expect(result.ok).toBe(true)
    for (const name of ["api", "endpoint", "storage", "gpu", "model"] as ConnectionLayer[]) {
      expect(layer(result, name).ok, `${name} should pass`).toBe(true)
    }
    expect(result.gpuName).toBe("NVIDIA RTX A4000")
    expect(result.separatorVersion).toBe("0.44.5")
    expect(result.model).toBe("htdemucs.yaml")
  })

  it("treats an endpoint with no warm workers as normal", async () => {
    // Scale-to-zero is the usual configuration; calling it a fault would fail
    // every correctly configured endpoint.
    const result = await testRunPodConnection(CREDENTIALS, deps({ health: async () => ({}) }))
    expect(layer(result, "endpoint").ok).toBe(true)
    expect(layer(result, "endpoint").detail).toMatch(/scales to zero/i)
  })
})

describe("the CPU refusal", () => {
  it("fails when the worker has no CUDA, however healthy everything else is", async () => {
    /**
     * The failure the whole cloud path exists to avoid. Separation would still
     * succeed — slowly, on CPU, billed as a GPU — so calling this "connected"
     * would hide exactly what the user is paying to escape.
     */
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({
        status: async () => ({
          id: "job-1",
          status: "COMPLETED",
          output: { ...HEALTHY_OUTPUT, gpu: { cuda_available: false } },
        }),
      }),
    )

    expect(result.ok).toBe(false)
    expect(layer(result, "gpu").ok).toBe(false)
    expect(layer(result, "gpu").reason).toMatch(/would run on CPU/i)
    // The layers before it did pass, and say so — the fault is named precisely.
    expect(layer(result, "api").ok).toBe(true)
    expect(layer(result, "storage").ok).toBe(true)
  })
})

describe("failures name the layer", () => {
  it("stops at the API when the key is rejected", async () => {
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({
        health: async () => {
          throw Object.assign(new Error("RunPod rejected the API key."), { name: "RunPodError" })
        },
      }),
    )

    expect(result.ok).toBe(false)
    expect(layer(result, "api").ok).toBe(false)
    // Nothing after it is claimed as working — an untested layer is reported as
    // untested rather than shown with a tick.
    expect(layer(result, "storage").reason).toBe("Not tested.")
    expect(layer(result, "gpu").reason).toBe("Not tested.")
  })

  it("names storage when the volume cannot be reached", async () => {
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({
        storage: async () => ({
          ok: false as const,
          reason: "The network volume was not found. Check the volume ID and its datacenter.",
        }),
      }),
    )

    expect(layer(result, "api").ok).toBe(true)
    expect(layer(result, "endpoint").ok).toBe(true)
    expect(layer(result, "storage").ok).toBe(false)
    expect(layer(result, "storage").reason).toMatch(/volume ID/i)
  })

  it("names the model layer when the image has no separator", async () => {
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({
        status: async () => ({
          id: "job-1",
          status: "COMPLETED",
          output: { ...HEALTHY_OUTPUT, separator_available: false },
        }),
      }),
    )
    expect(layer(result, "gpu").ok).toBe(true)
    expect(layer(result, "model").ok).toBe(false)
    expect(layer(result, "model").reason).toMatch(/separator installed/i)
  })

  it("names the volume when the worker has none mounted", async () => {
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({
        status: async () => ({
          id: "job-1",
          status: "COMPLETED",
          output: { ...HEALTHY_OUTPUT, volume_mounted: false },
        }),
      }),
    )
    // Distinct from a storage-credential failure: the credentials work, the
    // endpoint simply has no volume attached.
    expect(layer(result, "storage").ok).toBe(true)
    expect(layer(result, "model").reason).toMatch(/attach the volume/i)
  })

  it("reports a health job that ended badly", async () => {
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({ status: async () => ({ id: "job-1", status: "FAILED" }) }),
    )
    expect(result.ok).toBe(false)
    expect(layer(result, "gpu").reason).toMatch(/FAILED/)
  })

  it("gives up on a worker that never starts, and says why", async () => {
    let clock = 0
    const result = await testRunPodConnection(CREDENTIALS, {
      ...deps({ status: async () => ({ id: "job-1", status: "IN_QUEUE" }) }),
      // Time advances without waiting, so the timeout is reached instantly.
      now: () => (clock += 30_000),
    })

    expect(result.ok).toBe(false)
    // Cold starts are genuinely slow, so the message says that rather than
    // implying the endpoint is broken.
    expect(layer(result, "gpu").reason).toMatch(/cold start/i)
  })
})

describe("version drift", () => {
  it("passes, but says the image no longer matches its pin", async () => {
    /**
     * A drifted image still separates correctly — it just cannot share a stem
     * cache with this server, because the fingerprint includes the version. So
     * it is surfaced rather than failed.
     */
    const result = await testRunPodConnection(
      CREDENTIALS,
      deps({
        status: async () => ({
          id: "job-1",
          status: "COMPLETED",
          output: {
            ...HEALTHY_OUTPUT,
            separator: { version: "0.99.0", drift: "pinned 0.44.5 but running 0.99.0" },
          },
        }),
      }),
    )

    expect(result.ok).toBe(true)
    expect(layer(result, "model").ok).toBe(true)
    expect(layer(result, "model").reason).toMatch(/pinned 0\.44\.5/)
  })
})

describe("cost", () => {
  it("submits exactly one health job", async () => {
    const submit = vi.fn(async () => ({ id: "job-1", status: "IN_QUEUE" }))
    await testRunPodConnection(CREDENTIALS, deps({ submit }))
    // Pressing "Test connection" should cost one trivial job, not several.
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
