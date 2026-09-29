import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  describePublicSystemStatus,
  describeSystemStatus,
  SYSTEM_STATUS_COPY,
} from "@/components/dashboard/system-status"
import { ApiError } from "@/lib/api/errors"
import {
  canViewHealthDetails,
  fetchHealthDetails,
  fetchPublicHealth,
} from "@/lib/api/health"
import type { HealthStatus } from "@/lib/types/models"

/**
 * v1.1.1 acceptance: the dashboard's System card sat on "Checking services…"
 * on a healthy instance.
 *
 * The public `/health` was cut down to `{ status }` so an unauthenticated
 * caller no longer learns the version and every subsystem; the breakdown moved
 * to `/health/detailed` for owners and admins. The dashboard kept reading the
 * public endpoint, rejected the one-word answer for lacking `api`, and its
 * description treated "no data" as "still loading" even after the request had
 * failed.
 */

const healthy: HealthStatus = {
  api: "online",
  database: "online",
  redis: "online",
  realtime: "online",
  worker: "online",
  storage: "online",
  status: "ready",
  version: "1.1.1",
  timestamp: "2026-09-29T02:00:00.000Z",
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the dashboard reads the authenticated breakdown", () => {
  it("asks /health/detailed, with the session cookie", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: healthy }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchHealthDetails()).resolves.toEqual(healthy)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/health/detailed")
    expect(init.credentials).toBe("include")
  })

  it("reports a refusal as an error with its status, not as a pending check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, { error: { code: "FORBIDDEN", message: "You do not have access to this resource." } }),
      ),
    )
    const failure = await fetchHealthDetails().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(403)
  })

  it("rejects the public one-word body — the exact mismatch that stuck the card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: { status: "ok" } })))
    await expect(fetchHealthDetails()).rejects.toThrow(/unrecognised/)
  })

  it("is used by the System card, and nothing on the dashboard reads the breakdown from /health", () => {
    const read = (file: string) =>
      readFileSync(path.resolve(__dirname, "../apps/web/components/dashboard", file), "utf8")
    const section = read("system-status-section.tsx")
    expect(section).toContain("fetchHealthDetails")
    expect(section).toContain("canViewHealthDetails")
    expect(read("dashboard-home-intro.tsx")).toContain("fetchPublicHealth")
  })
})

describe("the public endpoint, as the dashboard reads it", () => {
  it("accepts the minimal ok answer", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { status: "ok" } }))
    vi.stubGlobal("fetch", fetchMock)
    await expect(fetchPublicHealth()).resolves.toEqual({ status: "ok" })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/health")
  })

  it("reads a 503 as a degraded report, not a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, { data: { status: "degraded" } })))
    await expect(fetchPublicHealth()).resolves.toEqual({ status: "degraded" })
  })

  it("still fails on anything it does not recognise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(502, "bad gateway")))
    await expect(fetchPublicHealth()).rejects.toThrow(/502/)
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: { api: "online" } })))
    await expect(fetchPublicHealth()).rejects.toThrow(/unrecognised/)
  })
})

describe("who gets the breakdown", () => {
  it("matches the API: owners and admins only", () => {
    expect(canViewHealthDetails("OWNER")).toBe(true)
    expect(canViewHealthDetails("ADMIN")).toBe(true)
    expect(canViewHealthDetails("MEMBER")).toBe(false)
    expect(canViewHealthDetails("VIEWER")).toBe(false)
    expect(canViewHealthDetails(undefined)).toBe(false)

    const route = readFileSync(
      path.resolve(__dirname, "../apps/api/src/routes/health.routes.ts"),
      "utf8",
    )
    expect(route).toMatch(/"\/health\/detailed",\s*\{\s*preHandler: requireSessionRole\(\["OWNER", "ADMIN"\]\)/)
  })
})

describe("the line above the System cards", () => {
  it("says Checking services… only while the first request is in flight", () => {
    expect(describeSystemStatus({ isPending: true, isError: false, health: undefined })).toBe(
      "Checking services…",
    )
  })

  it("resolves to the all-services message when everything is online", () => {
    expect(describeSystemStatus({ isPending: false, isError: false, health: healthy })).toBe(
      "All services responding on this host.",
    )
  })

  it("counts what is online when the instance is degraded", () => {
    const degraded = { ...healthy, redis: "offline", worker: "offline", status: "degraded" } as HealthStatus
    expect(describeSystemStatus({ isPending: false, isError: false, health: degraded })).toBe(
      "3 of 5 services online.",
    )
    const unknownWorker = { ...healthy, worker: "unknown" } as HealthStatus
    expect(describeSystemStatus({ isPending: false, isError: false, health: unknownWorker })).toBe(
      "4 of 5 services online.",
    )
  })

  it("does not stay on Checking services… after the request has failed", () => {
    const line = describeSystemStatus({ isPending: true, isError: true, health: undefined })
    expect(line).not.toBe(SYSTEM_STATUS_COPY.loading)
    expect(line).toBe("Could not load service status.")
  })

  it("does not keep saying all is well once a refetch has failed", () => {
    expect(describeSystemStatus({ isPending: false, isError: true, health: healthy })).toBe(
      SYSTEM_STATUS_COPY.error,
    )
  })

  it("gives members and viewers a clean summary instead of a refused request", () => {
    expect(describePublicSystemStatus({ isPending: true, isError: false, health: undefined })).toBe(
      SYSTEM_STATUS_COPY.loading,
    )
    expect(
      describePublicSystemStatus({ isPending: false, isError: false, health: { status: "ok" } }),
    ).toBe("Arciin is responding on this host.")
    expect(
      describePublicSystemStatus({ isPending: false, isError: false, health: { status: "degraded" } }),
    ).toBe(SYSTEM_STATUS_COPY.summaryDegraded)
    expect(
      describePublicSystemStatus({ isPending: true, isError: true, health: undefined }),
    ).toBe(SYSTEM_STATUS_COPY.error)
  })
})
