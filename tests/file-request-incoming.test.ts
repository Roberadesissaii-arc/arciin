import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import type { FolderIncomingSummary, RealtimeEvent } from "@arciin/shared"

import { emitRealtimeEvent } from "../apps/api/src/plugins/socket-emit"
import {
  INCOMING_PROGRESS_INTERVAL_MS,
  INCOMING_STALE_MS,
  forgetProgress,
  progressDue,
  summarizeIncoming,
} from "../apps/api/src/services/file-requests/incoming-summary"
import { MAX_SESSION_TOTAL_MS, extendedExpiry } from "../apps/api/src/services/file-requests/resumable-policy"
import { incomingBanner, incomingLabel } from "../apps/web/components/libraries/folder-incoming"
import { queryKeys } from "../apps/web/lib/api/query-keys"
import { applyIncomingEvent, mergeIncomingFolder, parseIncomingEvent } from "../apps/web/lib/realtime/incoming-uploads"
import { useIncomingStore } from "../apps/web/lib/stores/incoming-store"

vi.mock("../apps/web/lib/realtime/refresh-library-queries", () => ({ refreshLibraryQueries: vi.fn() }))

const NOW = 1_800_000_000_000
const H = 60 * 60 * 1000

function row(over: Partial<Parameters<typeof summarizeIncoming>[0][number]> = {}) {
  return {
    status: "UPLOADING",
    sizeBytes: 100n,
    receivedBytes: 0n,
    updatedAt: new Date(NOW - 1000),
    expiresAt: new Date(NOW + H),
    folderId: "f1",
    libraryId: "l1",
    ...over,
  }
}

describe("summarizeIncoming", () => {
  it("aggregates by bytes, not by file", () => {
    const [s] = summarizeIncoming(
      [row({ sizeBytes: 900n, receivedBytes: 90n }), row({ sizeBytes: 100n, receivedBytes: 100n })],
      NOW,
    )
    // Two files, one finished: by file that is 55%; by bytes it is 19%.
    expect(s).toMatchObject({ activeUploadCount: 2, totalBytes: 1000, receivedBytes: 190, progressPercent: 19, state: "RECEIVING" })
  })

  it("groups per folder", () => {
    const out = summarizeIncoming([row(), row({ folderId: "f2" }), row()], NOW)
    expect(out.map((f) => [f.folderId, f.activeUploadCount]).sort()).toEqual([["f1", 2], ["f2", 1]])
  })

  it("ignores finished, cancelled, failed and expired sessions", () => {
    const out = summarizeIncoming(
      [
        row({ status: "COMPLETE" }),
        row({ status: "CANCELLED" }),
        row({ status: "FAILED" }),
        row({ status: "EXPIRED" }),
        row({ expiresAt: new Date(NOW - 1) }),
      ],
      NOW,
    )
    expect(out).toEqual([])
  })

  it("an upload with no bytes for a while is waiting; any recent one makes the folder receiving", () => {
    const stale = row({ updatedAt: new Date(NOW - INCOMING_STALE_MS - 1) })
    expect(summarizeIncoming([stale], NOW)[0]!.state).toBe("WAITING")
    expect(summarizeIncoming([stale, row()], NOW)[0]!.state).toBe("RECEIVING")
  })

  it("verifying shows when nothing is still receiving", () => {
    const verifying = row({ status: "VERIFYING", receivedBytes: 100n })
    expect(summarizeIncoming([verifying], NOW)[0]!.state).toBe("VERIFYING")
    expect(summarizeIncoming([verifying, row()], NOW)[0]!.state).toBe("RECEIVING")
  })

  it("never reports more than 100%, and an empty file counts as done", () => {
    expect(summarizeIncoming([row({ receivedBytes: 500n })], NOW)[0]!.progressPercent).toBe(100)
    expect(summarizeIncoming([row({ sizeBytes: 0n })], NOW)[0]!.progressPercent).toBe(100)
  })

  it("floors, so 99.9% is not shown as done", () => {
    expect(summarizeIncoming([row({ sizeBytes: 1000n, receivedBytes: 999n })], NOW)[0]!.progressPercent).toBe(99)
  })

  it("the summary has only counts, bytes and ids", () => {
    const [s] = summarizeIncoming([row()], NOW)
    expect(Object.keys(s!).sort()).toEqual(
      ["activeUploadCount", "folderId", "libraryId", "progressPercent", "receivedBytes", "state", "totalBytes"],
    )
  })
})

describe("progressDue", () => {
  it("throttles per upload, but always lets the final chunk through", () => {
    expect(progressDue("u1", NOW, false)).toBe(true)
    expect(progressDue("u1", NOW + 100, false)).toBe(false)
    expect(progressDue("u2", NOW + 100, false)).toBe(true)
    expect(progressDue("u1", NOW + 200, true)).toBe(true)
    expect(progressDue("u1", NOW + 200 + INCOMING_PROGRESS_INTERVAL_MS, false)).toBe(true)
    forgetProgress("u1")
    expect(progressDue("u1", NOW + 201 + INCOMING_PROGRESS_INTERVAL_MS, false)).toBe(true)
  })
})

describe("extendedExpiry", () => {
  const createdAt = new Date(NOW - 20 * H)
  it("moves a live transfer's expiry to a full lifetime from now", () => {
    const out = extendedExpiry({ createdAt, expiresAt: new Date(NOW + 4 * H), now: NOW, lifetimeMs: 24 * H })
    expect(out.getTime()).toBe(NOW + 24 * H)
  })
  it("never shortens it", () => {
    const out = extendedExpiry({ createdAt, expiresAt: new Date(NOW + 30 * H), now: NOW, lifetimeMs: 1 * H })
    expect(out.getTime()).toBe(NOW + 30 * H)
  })
  it("never passes the absolute cap from the start", () => {
    const old = new Date(NOW - MAX_SESSION_TOTAL_MS + H)
    const out = extendedExpiry({ createdAt: old, expiresAt: new Date(NOW + 10 * 60 * 1000), now: NOW, lifetimeMs: 24 * H })
    expect(out.getTime()).toBe(old.getTime() + MAX_SESSION_TOTAL_MS)
  })
})

describe("emitRealtimeEvent audience", () => {
  function fakeIo() {
    const sent: string[] = []
    return {
      sent,
      io: {
        to: (room: string) => ({ emit: () => sent.push(room) }),
        emit: () => sent.push("*broadcast*"),
      } as unknown as Parameters<typeof emitRealtimeEvent>[0],
    }
  }
  const event = (over: Partial<RealtimeEvent>): RealtimeEvent => ({
    id: "e1",
    type: "file-request.incoming",
    createdAt: new Date(NOW).toISOString(),
    ...over,
  })

  it("a user-only event reaches that user's room and nowhere else, even with an instance id", () => {
    const { io, sent } = fakeIo()
    emitRealtimeEvent(io, event({ audience: "user", userId: "owner", instanceId: "i1", libraryId: "l1" }))
    expect(sent).toEqual(["user:owner"])
  })

  it("a user-only event without a user goes nowhere — never a broadcast", () => {
    const { io, sent } = fakeIo()
    emitRealtimeEvent(io, event({ audience: "user" }))
    expect(sent).toEqual([])
  })

  it("other events keep their fan-out", () => {
    const { io, sent } = fakeIo()
    emitRealtimeEvent(io, event({ type: "asset.created", userId: "u", instanceId: "i1" }))
    expect(sent).toEqual(["user:u", "instance:i1"])
  })
})

const folder = (over: Partial<FolderIncomingSummary> = {}): FolderIncomingSummary => ({
  folderId: "f1",
  libraryId: "l1",
  activeUploadCount: 1,
  totalBytes: 1000,
  receivedBytes: 380,
  progressPercent: 38,
  state: "RECEIVING",
  ...over,
})

describe("web: incoming event handling", () => {
  it("parses only well-formed payloads", () => {
    expect(parseIncomingEvent({ phase: "progress", folder: folder() })).not.toBeNull()
    expect(parseIncomingEvent(null)).toBeNull()
    expect(parseIncomingEvent({ phase: "bogus", folder: folder() })).toBeNull()
    expect(parseIncomingEvent({ phase: "progress", folder: { ...folder(), receivedBytes: -1 } })).toBeNull()
    expect(parseIncomingEvent({ phase: "progress", folder: { ...folder(), state: "HACKED" } })).toBeNull()
    expect(parseIncomingEvent({ phase: "progress", folder: { ...folder(), folderId: 5 } })).toBeNull()
  })

  it("merges a folder in, replaces it, and drops it when nothing is open", () => {
    const one = mergeIncomingFolder({ folders: [] }, folder(), null)!
    expect(one.folders).toHaveLength(1)
    const two = mergeIncomingFolder(one, folder({ progressPercent: 60, receivedBytes: 600 }), null)!
    expect(two.folders).toEqual([folder({ progressPercent: 60, receivedBytes: 600 })])
    expect(mergeIncomingFolder(two, folder({ activeUploadCount: 0, state: "IDLE" }), null)!.folders).toEqual([])
    // A snapshot filtered to another library is left alone.
    expect(mergeIncomingFolder({ folders: [] }, folder(), "other")!.folders).toEqual([])
    // Nothing cached yet: nothing to merge into.
    expect(mergeIncomingFolder(undefined, folder(), null)).toBeUndefined()
  })

  it("applies events to cached snapshots; completion flashes Received and refreshes the library", async () => {
    const { refreshLibraryQueries } = await import("../apps/web/lib/realtime/refresh-library-queries")
    const qc = new QueryClient()
    qc.setQueryData(queryKeys.incomingUploads(), { folders: [] })
    applyIncomingEvent(qc, { phase: "started", folder: folder({ receivedBytes: 0, progressPercent: 0 }) })
    applyIncomingEvent(qc, { phase: "progress", folder: folder() })
    expect(qc.getQueryData<{ folders: FolderIncomingSummary[] }>(queryKeys.incomingUploads())!.folders[0]!.progressPercent).toBe(38)
    expect(refreshLibraryQueries).not.toHaveBeenCalled()

    applyIncomingEvent(qc, { phase: "completed", folder: folder({ activeUploadCount: 0, state: "IDLE", progressPercent: 100 }) })
    expect(qc.getQueryData<{ folders: FolderIncomingSummary[] }>(queryKeys.incomingUploads())!.folders).toEqual([])
    expect(useIncomingStore.getState().receivedAt.f1).toBeTypeOf("number")
    expect(refreshLibraryQueries).toHaveBeenCalledWith(qc, "l1")
  })

  it("a completion while other files still arrive does not flash Received", () => {
    useIncomingStore.getState().clearReceived("f9")
    const qc = new QueryClient()
    applyIncomingEvent(qc, { phase: "completed", folder: folder({ folderId: "f9", activeUploadCount: 1 }) })
    expect(useIncomingStore.getState().receivedAt.f9).toBeUndefined()
  })
})

describe("folder labels", () => {
  it("names the state truthfully", () => {
    expect(incomingLabel(folder())).toBe("Receiving")
    expect(incomingLabel(folder({ activeUploadCount: 3 }))).toBe("3 incoming")
    expect(incomingLabel(folder({ state: "VERIFYING" }))).toBe("Verifying")
    expect(incomingLabel(folder({ state: "WAITING" }))).toBe("Waiting")
  })
  it("banner reads like the spec", () => {
    expect(incomingBanner(folder())).toMatch(/^Receiving 1 file · 38% · /)
    expect(incomingBanner(folder({ activeUploadCount: 2 }))).toMatch(/^Receiving 2 files · 38%/)
    expect(incomingBanner(folder({ state: "WAITING" }))).toMatch(/^Waiting on 1 file/)
  })
})

describe("request logs never carry a link token", () => {
  it("redacts the File Request token in every upload route, keeping the rest of the path", async () => {
    const { redactSensitiveUrl, serializeRequestForLog } = await import(
      "../apps/api/src/services/security/request-log-redaction"
    )
    const token = "frq_0123456789abcdef0123456789abcdef"
    for (const url of [
      `/api/public/file-requests/${token}`,
      `/api/public/file-requests/${token}/uploads`,
      `/api/public/file-requests/${token}/uploads/cmabc123/chunks?offset=16777216`,
      `/api/public/file-requests/${token}/uploads/cmabc123/complete`,
      `/api/public/file-requests/${token}/submissions/sub1/complete`,
    ]) {
      const out = redactSensitiveUrl(url)
      expect(out).not.toContain(token)
      expect(out).toContain("/public/file-requests/[redacted]")
      expect(JSON.stringify(serializeRequestForLog({ method: "PUT", url }))).not.toContain(token)
    }
    expect(redactSensitiveUrl(`/api/public/file-requests/${token}/uploads/cmabc123/chunks?offset=16777216`)).toBe(
      "/api/public/file-requests/[redacted]/uploads/cmabc123/chunks?offset=16777216",
    )
  })

  it("redacts share tokens too, and leaves ordinary paths alone", async () => {
    const { redactSensitiveUrl } = await import("../apps/api/src/services/security/request-log-redaction")
    expect(redactSensitiveUrl("/api/shares/access/shr_secret/download/a1")).toBe("/api/shares/access/[redacted]/download/a1")
    expect(redactSensitiveUrl("/api/shares/access/shr_secret?token=x")).toBe("/api/shares/access/[redacted]?token=%5Bredacted%5D")
    expect(redactSensitiveUrl("/api/file-requests/incoming?folderId=f1")).toBe("/api/file-requests/incoming?folderId=f1")
    expect(redactSensitiveUrl("/api/libraries/x")).toBe("/api/libraries/x")
  })

  it("the chunk route logs below info unless debugging", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("apps/api/src/modules/file-requests/resumable-routes.ts", "utf8")
    expect(src).toMatch(/fastify\.put\("\/public\/file-requests\/:token\/uploads\/:uploadId\/chunks", \{ logLevel: chunkLogLevel \}/)
    expect(src).toContain(': "warn"')
  })
})
