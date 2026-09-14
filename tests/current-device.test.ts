import { describe, expect, it } from "vitest"

import {
  DEVICE_RECENTLY_SEEN_MS,
  devicePresenceLabel,
  resolveCurrentDeviceId,
  resolveDevicePresence,
} from "@arciin/shared"

describe("resolveCurrentDeviceId", () => {
  it("returns the session device when it is still active", () => {
    expect(resolveCurrentDeviceId("dev-1", ["dev-2", "dev-1"])).toBe("dev-1")
  })

  it("returns null for a normal browser session", () => {
    expect(resolveCurrentDeviceId(null, ["dev-1"])).toBeNull()
    expect(resolveCurrentDeviceId(undefined, ["dev-1"])).toBeNull()
  })

  it("ignores a paired id that is not in the active list", () => {
    expect(resolveCurrentDeviceId("revoked", ["dev-1"])).toBeNull()
  })
})

describe("resolveDevicePresence", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z")

  it("marks the current device as connected", () => {
    expect(
      resolveDevicePresence({
        isCurrentDevice: true,
        lastSeenAt: null,
        now,
      }),
    ).toBe("connected")
    expect(devicePresenceLabel("connected")).toBe("Connected")
  })

  it("marks a recently seen other device as active", () => {
    expect(
      resolveDevicePresence({
        isCurrentDevice: false,
        lastSeenAt: new Date(now - 60_000).toISOString(),
        now,
      }),
    ).toBe("active")
    expect(devicePresenceLabel("active")).toBe("Active")
  })

  it("marks a stale or unseen other device as trusted, not active", () => {
    expect(
      resolveDevicePresence({
        isCurrentDevice: false,
        lastSeenAt: new Date(now - DEVICE_RECENTLY_SEEN_MS - 1).toISOString(),
        now,
      }),
    ).toBe("trusted")
    expect(
      resolveDevicePresence({
        isCurrentDevice: false,
        lastSeenAt: null,
        now,
      }),
    ).toBe("trusted")
    expect(devicePresenceLabel("trusted")).toBe("Trusted")
  })
})
