import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_CHUNK_SIZE_BYTES,
  GIB,
  MIB,
  capacityDecision,
  expectedChunkLength,
  isSafeUploadId,
  placeChunk,
  resolveChunkSizeBytes,
  safetyMarginBytes,
} from "../apps/api/src/services/file-requests/resumable-policy"

describe("chunk size", () => {
  it("defaults to 16 MiB, far under a proxied request-body ceiling", () => {
    expect(DEFAULT_CHUNK_SIZE_BYTES).toBe(16 * MIB)
    expect(DEFAULT_CHUNK_SIZE_BYTES).toBeLessThan(100 * 1000 * 1000)
    expect(resolveChunkSizeBytes({})).toBe(16 * MIB)
  })
  it("is configurable but clamped to 1–64 MiB", () => {
    expect(resolveChunkSizeBytes({ ARCIIN_UPLOAD_CHUNK_SIZE_MB: "32" })).toBe(32 * MIB)
    expect(resolveChunkSizeBytes({ ARCIIN_UPLOAD_CHUNK_SIZE_MB: "900" })).toBe(64 * MIB)
    expect(resolveChunkSizeBytes({ ARCIIN_UPLOAD_CHUNK_SIZE_MB: "0" })).toBe(16 * MIB)
    expect(resolveChunkSizeBytes({ ARCIIN_UPLOAD_CHUNK_SIZE_MB: "junk" })).toBe(16 * MIB)
  })
  it("the last chunk is the remainder", () => {
    expect(expectedChunkLength(2 * GIB, 0, 16 * MIB)).toBe(16 * MIB)
    expect(expectedChunkLength(2 * GIB + 5, 2 * GIB, 16 * MIB)).toBe(5)
  })
})

describe("placeChunk", () => {
  const base = { receivedBytes: 32 * MIB, totalBytes: 2 * GIB, chunkSize: 16 * MIB }
  it("appends at the received offset", () => {
    expect(placeChunk({ ...base, offset: 32 * MIB })).toEqual({ kind: "append" })
  })
  it("acknowledges a retry of a chunk already stored", () => {
    expect(placeChunk({ ...base, offset: 16 * MIB })).toEqual({ kind: "duplicate" })
  })
  it("refuses gaps, off-grid, negative and past-the-end offsets, saying where to resume", () => {
    for (const offset of [48 * MIB, 32 * MIB + 1, -1, 2 * GIB, Number.NaN]) {
      expect(placeChunk({ ...base, offset })).toEqual({ kind: "invalid", expectedOffset: 32 * MIB })
    }
  })
  it("works past 2^31 and 2^32", () => {
    expect(placeChunk({ offset: 3 * GIB, receivedBytes: 3 * GIB, totalBytes: 5 * GIB, chunkSize: 16 * MIB })).toEqual({ kind: "append" })
  })
})

describe("capacity", () => {
  it("rejects a 2 GB upload with 1.4 GB free", () => {
    const d = capacityDecision({ requestedBytes: 2 * GIB, availableBytes: 1.4 * GIB, outstandingBytes: 0, totalBytes: 100 * GIB })
    expect(d.ok).toBe(false)
  })
  it("counts what other uploads still need", () => {
    const free = 5 * GIB + safetyMarginBytes(10 * GIB)
    expect(capacityDecision({ requestedBytes: 4 * GIB, availableBytes: free, outstandingBytes: 0, totalBytes: 10 * GIB }).ok).toBe(true)
    expect(capacityDecision({ requestedBytes: 4 * GIB, availableBytes: free, outstandingBytes: 4 * GIB, totalBytes: 10 * GIB }).ok).toBe(false)
  })
  it("keeps a margin and refuses when the disk cannot be measured", () => {
    expect(safetyMarginBytes(100 * GIB)).toBe(2 * GIB)
    expect(safetyMarginBytes(10 * GIB)).toBe(GIB)
    expect(capacityDecision({ requestedBytes: 1, availableBytes: null, outstandingBytes: 0, totalBytes: null }).ok).toBe(false)
  })
})

describe("upload ids become file names only if they are ours", () => {
  it("accepts cuids, rejects paths", () => {
    expect(isSafeUploadId("cmufazqb30003to489rkbcdhe")).toBe(true)
    for (const bad of ["../x", "a/b", "", "ABC", "x".repeat(80)]) expect(isSafeUploadId(bad)).toBe(false)
  })
})

describe("no whole-file buffering, by construction", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8")
  it("the chunk route streams the body to disk", () => {
    const routes = read("apps/api/src/modules/file-requests/resumable-routes.ts")
    const storage = read("apps/api/src/services/file-requests/resumable-storage.ts")
    for (const text of [routes, storage]) {
      expect(text).not.toMatch(/\.arrayBuffer\(|Buffer\.concat\(|readFile\(/)
    }
    expect(routes).toContain('addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload))')
  })
  it("the browser reads one chunk slice at a time", () => {
    const client = read("apps/web/lib/uploads/resumable-upload.ts")
    expect(client).toContain("input.file.slice(offset, end)")
    expect(client).not.toMatch(/input\.file\.arrayBuffer\(|file\.text\(\)/)
  })
  it("the Next proxy no longer runs on /api, so it cannot buffer upload bodies", () => {
    const proxy = read("apps/web/proxy.ts")
    expect(proxy).toContain("api(?:/|$)")
  })
})
