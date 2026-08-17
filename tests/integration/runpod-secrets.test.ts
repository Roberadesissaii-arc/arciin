import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  disconnectRunPod,
  getRunPodCredentials,
  getRunPodStatus,
  maskIdentifier,
  recordRunPodTest,
  s3EndpointFor,
  saveRunPodConnection,
} from "../../apps/api/src/services/dubbing/runpod-config"
import { loadDubbingSettings, saveSeparationMode } from "../../apps/api/src/services/dubbing/separation-settings"

import { prisma, resetDatabase } from "./setup"

/**
 * Where the RunPod credentials go, and where they must never appear.
 *
 * These are billing-capable secrets that decide where a user's audio is allowed
 * to travel. Two of them are also easy to confuse with each other, so the tests
 * below check both the storage and the reporting: encrypted at rest, absent
 * from every read path a browser can reach, and never echoed back after save.
 *
 * Against a real database rather than a mock, because "is it actually encrypted
 * in the column" is a question about the column.
 */

const CONNECTION = {
  apiKey: "rpa_super_secret_key_value",
  endpointId: "endpoint-abcdef123456",
  volumeId: "vol-zyxwvu987654",
  datacenter: "EU-CZ-1",
  s3AccessKeyId: "user_access_identifier",
  s3SecretAccessKey: "rps_super_secret_storage_value",
}

/** Everything that must never be readable outside the server. */
const SECRETS = [CONNECTION.apiKey, CONNECTION.s3SecretAccessKey]

beforeAll(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await resetDatabase()
  await prisma.$disconnect()
})

/**
 * The instance is created here rather than once in `beforeAll`.
 *
 * These files share one database and run serially, so a row created in a
 * `beforeAll` can be removed by a neighbouring file's reset. Recreating it per
 * test makes this file independent of whatever ran before it — which is worth
 * more than the saved insert.
 */
beforeEach(async () => {
  const existing = await prisma.instanceConfig.findFirst({ select: { id: true } })
  if (existing) {
    await prisma.instanceConfig.update({
      where: { id: existing.id },
      data: { dubbingConfig: {} },
    })
    return
  }
  await prisma.instanceConfig.create({
    data: {
      instanceName: "Secret Test",
      storageRoot: "/tmp/arciin-secret-test",
      initializedAt: new Date(),
    },
  })
})

describe("storage", () => {
  it("keeps no plaintext secret in the database", async () => {
    await saveRunPodConnection(prisma, CONNECTION)

    const row = await prisma.instanceConfig.findFirstOrThrow({ select: { dubbingConfig: true } })
    const serialised = JSON.stringify(row.dubbingConfig)

    /**
     * The whole column, not just the fields — a secret copied into an audit
     * field or a "last error" would be just as readable.
     */
    for (const secret of SECRETS) {
      expect(serialised, `plaintext secret found in dubbingConfig`).not.toContain(secret)
    }
  })

  it("still round-trips them for the worker", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    const credentials = await getRunPodCredentials(prisma)

    expect(credentials?.apiKey).toBe(CONNECTION.apiKey)
    expect(credentials?.s3SecretAccessKey).toBe(CONNECTION.s3SecretAccessKey)
  })

  it("derives the S3 host from the datacenter so the two cannot disagree", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    const credentials = await getRunPodCredentials(prisma)

    // Asking for both invites the mismatch that produces "bucket not found"
    // against perfectly valid credentials.
    expect(credentials?.s3Endpoint).toBe("https://s3api-eu-cz-1.runpod.io")
    expect(s3EndpointFor("US-CA-2")).toBe("https://s3api-us-ca-2.runpod.io")
  })
})

describe("what the browser can see", () => {
  it("returns no secret in the status payload", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    const status = await getRunPodStatus(prisma)
    const serialised = JSON.stringify(status)

    for (const secret of SECRETS) {
      expect(serialised, "status must never carry a secret").not.toContain(secret)
    }
    // The access key id is an identifier rather than a secret, but there is no
    // reason for a browser to have it either.
    expect(serialised).not.toContain(CONNECTION.s3AccessKeyId)
  })

  it("shows enough to recognise the connection and no more", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    const status = await getRunPodStatus(prisma)

    expect(status.configured).toBe(true)
    expect(status.endpointDisplay).toBe(maskIdentifier(CONNECTION.endpointId))
    expect(status.endpointDisplay).toContain("…")
    // Masked, so two endpoints are distinguishable without either being usable.
    expect(status.endpointDisplay).not.toBe(CONNECTION.endpointId)
    expect(status.datacenter).toBe("eu-cz-1")
  })

  it("reports nothing at all when unconfigured", async () => {
    const status = await getRunPodStatus(prisma)
    expect(status.configured).toBe(false)
    expect(status.endpointDisplay).toBeNull()
  })

  it("keeps a recorded test result free of secrets", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    await recordRunPodTest(prisma, {
      ok: true,
      at: new Date().toISOString(),
      gpuName: "NVIDIA RTX A4000",
      cudaAvailable: true,
      separatorVersion: "0.44.5",
      model: "htdemucs.yaml",
    })

    const status = await getRunPodStatus(prisma)
    expect(status.lastTest?.gpuName).toBe("NVIDIA RTX A4000")
    expect(JSON.stringify(status)).not.toContain(CONNECTION.apiKey)

    // And recording a test must not have destroyed the connection.
    expect((await getRunPodCredentials(prisma))?.apiKey).toBe(CONNECTION.apiKey)
  })
})

describe("disconnect", () => {
  it("removes the credentials", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    await disconnectRunPod(prisma)

    expect(await getRunPodCredentials(prisma)).toBeNull()
    expect((await getRunPodStatus(prisma)).configured).toBe(false)

    const row = await prisma.instanceConfig.findFirstOrThrow({ select: { dubbingConfig: true } })
    for (const secret of SECRETS) {
      expect(JSON.stringify(row.dubbingConfig)).not.toContain(secret)
    }
  })

  it("does not leave Cloud selected with nothing behind it", async () => {
    /**
     * An explicit Cloud choice is never silently run locally, so leaving the
     * mode on Cloud after disconnecting would mean every dub failing with
     * "cloud unavailable" until someone noticed the setting.
     */
    await saveRunPodConnection(prisma, CONNECTION)
    await saveSeparationMode(prisma, "cloud")

    await disconnectRunPod(prisma)
    expect((await loadDubbingSettings(prisma)).separationMode).toBe("auto")
  })

  it("leaves an explicitly local preference alone", async () => {
    await saveRunPodConnection(prisma, CONNECTION)
    await saveSeparationMode(prisma, "local")

    await disconnectRunPod(prisma)
    // Nothing about local depended on the provider, so nothing about it changes.
    expect((await loadDubbingSettings(prisma)).separationMode).toBe("local")
  })

  it("survives being called when nothing is connected", async () => {
    const status = await disconnectRunPod(prisma)
    expect(status.configured).toBe(false)
  })
})

describe("partial configuration", () => {
  it("treats an incomplete stored connection as absent", async () => {
    /**
     * A half-written entry must not make Cloud selectable: the reader would be
     * offered a provider that can only fail after they had waited for it.
     */
    const instance = await prisma.instanceConfig.findFirstOrThrow({ select: { id: true } })
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: { dubbingConfig: { runpod: { endpointId: "endpoint-only" } } },
    })

    expect((await getRunPodStatus(prisma)).configured).toBe(false)
    expect(await getRunPodCredentials(prisma)).toBeNull()
  })

  it("treats undecryptable ciphertext as absent rather than crashing a dub", async () => {
    // What a rotated encryption key looks like from here.
    const instance = await prisma.instanceConfig.findFirstOrThrow({ select: { id: true } })
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: {
        dubbingConfig: {
          runpod: {
            endpointId: "e",
            volumeId: "v",
            datacenter: "eu-cz-1",
            s3AccessKeyId: "a",
            apiKey: "not-valid-ciphertext",
            s3SecretAccessKey: "also-not-valid",
            connectedAt: new Date().toISOString(),
          },
        },
      },
    })

    expect(await getRunPodCredentials(prisma)).toBeNull()
  })
})
