import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/errors"
import { seatLimitFromError } from "@/lib/api/license"

/**
 * Settings → License when every seat is taken: the panel must name the servers
 * holding the seats and send the owner to arciin.com/account — the one place
 * seats are released — instead of a bare "limit reached".
 */

describe("seat limit in the license panel", () => {
  it("reads the servers out of a SERVER_LIMIT_REACHED error", () => {
    const error = new ApiError("in use", {
      status: 400,
      code: "SERVER_LIMIT_REACHED",
      details: {
        serverLimit: 1,
        manageUrl: "https://arciin.com/account",
        servers: [{ name: "Office", instanceIdShort: "abcd1234", version: "1.1.3", lastCheckInAt: null, activatedAt: "2026-01-01T00:00:00Z" }],
      },
    })
    const limit = seatLimitFromError(error)
    expect(limit?.servers[0]?.name).toBe("Office")
    expect(limit?.serverLimit).toBe(1)
  })

  it("still explains the limit when an older authority sends no details", () => {
    const limit = seatLimitFromError(new ApiError("Server limit reached (1).", { code: "SERVER_LIMIT_REACHED" }))
    expect(limit).toEqual({ serverLimit: 0, servers: [], manageUrl: "https://arciin.com/account" })
  })

  it("ignores every other error", () => {
    expect(seatLimitFromError(new ApiError("revoked", { code: "LICENSE_REVOKED" }))).toBeNull()
    expect(seatLimitFromError(new Error("network"))).toBeNull()
  })

  it("the panel renders the notice with a link to the account portal", () => {
    const panel = readFileSync(path.resolve(import.meta.dirname, "../apps/web/components/settings/license-panel.tsx"), "utf8")
    expect(panel).toContain("<SeatLimitNotice")
    expect(panel).toContain("href={accountUrl()}")
    expect(panel).toContain("instanceIdShort")
  })

  it("the demo account portal says on every page that it is not a customer account", () => {
    const banner = readFileSync(path.resolve(import.meta.dirname, "../apps/account/components/demo-banner.tsx"), "utf8")
    expect(banner).toContain("this is not your Arciin account")
    expect(banner).toContain("https://arciin.com/account")
  })
})
