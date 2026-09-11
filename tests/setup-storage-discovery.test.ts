import { describe, expect, it } from "vitest"

import { toSetupStorageDiscovery } from "../apps/api/src/services/storage/setup-storage-view"
import {
  logContainsSecret,
  redactSensitiveHeaders,
  redactSensitiveUrl,
  serializeRequestForLog,
} from "../apps/api/src/services/security/request-log-redaction"

describe("setup discovery payload is minimized (ARC-008)", () => {
  it("drops host topology the wizard does not need", () => {
    const minimized = toSetupStorageDiscovery({
      recommendedArciinPath: "/srv/arciin-storage/arciin",
      isDockerRuntime: true,
      volumes: [
        {
          id: "recommended",
          label: "Recommended",
          arciinPath: "/srv/arciin-storage/arciin",
          kind: "recommended",
          totalBytes: 100,
          availableBytes: 50,
          writable: true,
          recommended: true,
          largeExternal: false,
          mountPoint: "/srv",
          filesystem: "ext4",
          device: "/dev/nvme0n1p2",
        },
      ],
      unmountedDevices: [
        {
          id: "unmounted-sdb1",
          device: "/dev/sdb1",
          name: "sdb1",
          sizeLabel: "2T",
          sizeBytes: 2,
          isLuks: false,
          needsFormat: false,
          type: "part",
          suggestedMountPoint: "/mnt/arciin-sdb1",
          suggestedArciinPath: "/mnt/arciin-sdb1/arciin",
          model: "Samsung",
          transport: "sata",
        },
      ],
    })

    expect(minimized.recommendedArciinPath).toBe("/srv/arciin-storage/arciin")
    expect(minimized.volumes[0]?.arciinPath).toBe("/srv/arciin-storage/arciin")
    expect(minimized.unmountedDevices[0]?.device).toBe("/dev/sdb1")
    expect(JSON.stringify(minimized)).not.toContain("/dev/nvme0n1")
    expect(JSON.stringify(minimized)).not.toContain("Samsung")
    expect(JSON.stringify(minimized)).not.toContain("ext4")
    expect(Object.keys(minimized).sort()).toEqual([
      "isDockerRuntime",
      "recommendedArciinPath",
      "unmountedDevices",
      "volumes",
    ])
  })
})

describe("request logs redact setup credentials (ARC-008)", () => {
  const secret = "super-secret-setup-token-value"

  it("redacts token query parameters", () => {
    const url = redactSensitiveUrl(`/instance/storage-discovery?token=${secret}`)
    expect(url).not.toContain(secret)
    expect(url.toLowerCase()).toMatch(/redacted/)
  })

  it("redacts the setup header", () => {
    const headers = redactSensitiveHeaders({
      "x-arciin-setup-token": secret,
      "content-type": "application/json",
    })
    expect(headers["x-arciin-setup-token"]).toBe("[redacted]")
    expect(headers["content-type"]).toBe("application/json")
    expect(logContainsSecret(headers, secret)).toBe(false)
  })

  it("serialized request lines never include the secret", () => {
    const logged = serializeRequestForLog({
      method: "GET",
      url: `/instance/storage-discovery?setupToken=${secret}`,
      headers: { "x-arciin-setup-token": secret },
    })
    expect(logContainsSecret(logged, secret)).toBe(false)
  })
})
