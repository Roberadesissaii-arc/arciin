import { describe, expect, it } from "vitest"

import {
  BACKOFF_MS,
  UploadHttpError,
  UploadPausedError,
  UploadStalledError,
  runResumableUpload,
  type ResumableTransport,
} from "../apps/web/lib/uploads/resumable-upload"

/**
 * The browser upload loop against a fake server. Covers what a flaky network
 * does to it: lost connections, lost responses, a server that knows better
 * about the offset, and a connection that never comes back.
 */

function fakeServer(total: number, chunkSize: number) {
  const received = new Uint8Array(total)
  let offset = 0
  const puts: number[] = []
  let failNext = 0
  let loseResponseOnce = false
  const transport: ResumableTransport = {
    create: async () => ({ uploadId: "u1", status: "UPLOADING", totalBytes: total, uploadedBytes: offset, chunkSize, expiresAt: "" }),
    status: async () => {
      if (failNext > 0) throw new UploadHttpError(0, "NETWORK", "down")
      return { uploadId: "u1", status: "UPLOADING", totalBytes: total, uploadedBytes: offset, chunkSize, expiresAt: "" }
    },
    putChunk: async ({ offset: at, body }) => {
      puts.push(at)
      if (failNext > 0) {
        failNext -= 1
        throw new UploadHttpError(0, "NETWORK", "Connection interrupted.")
      }
      if (at > offset) throw new UploadHttpError(409, "INVALID_UPLOAD_OFFSET", "gap", { expectedOffset: offset })
      const bytes = new Uint8Array(await body.arrayBuffer())
      if (at === offset) {
        received.set(bytes, at)
        offset = at + bytes.length
      }
      if (loseResponseOnce) {
        loseResponseOnce = false
        throw new UploadHttpError(502, "HTTP_502", "Bad gateway") // stored, but the reply was lost
      }
      return { uploadedBytes: offset }
    },
    complete: async () => ({ uploadId: "u1", status: "COMPLETE", totalBytes: total, uploadedBytes: offset, chunkSize, expiresAt: "" }),
    cancel: async () => {},
  }
  return {
    transport,
    received,
    puts,
    get offset() {
      return offset
    },
    set offset(v: number) {
      offset = v
    },
    failFor(n: number) {
      failNext = n
    },
    loseNextResponse() {
      loseResponseOnce = true
    },
  }
}

const source = (n: number) => new Blob([Uint8Array.from({ length: n }, (_, i) => i % 256)])
const meta = (n: number) => ({ filename: "f.bin", sizeBytes: n, mimeType: null, lastModified: null })

describe("runResumableUpload", () => {
  it("sends every byte in order, one chunk at a time", async () => {
    const server = fakeServer(10_000, 4096)
    const done = await runResumableUpload({ file: source(10_000), meta: meta(10_000), transport: server.transport, sleep: async () => {} })
    expect(done.status).toBe("COMPLETE")
    expect(server.puts).toEqual([0, 4096, 8192])
    expect(Array.from(server.received)).toEqual(Array.from({ length: 10_000 }, (_, i) => i % 256))
  })

  it("backs off 1s, 2s, 4s… on a dropped connection, then resumes from the server's offset", async () => {
    const server = fakeServer(12_000, 4096)
    const slept: number[] = []
    let first = true
    const states: string[] = []
    const result = runResumableUpload({
      file: source(12_000),
      meta: meta(12_000),
      transport: {
        ...server.transport,
        putChunk: async (args) => {
          if (args.offset === 4096 && first) {
            first = false
            server.failFor(3) // this put and two status/put attempts fail
          }
          return server.transport.putChunk(args)
        },
      },
      onState: (s) => states.push(s),
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    await expect(result).resolves.toMatchObject({ status: "COMPLETE" })
    expect(slept.slice(0, 2)).toEqual([BACKOFF_MS[0], BACKOFF_MS[1]])
    expect(states).toContain("reconnecting")
    expect(server.offset).toBe(12_000)
    // Never restarted from zero after the first chunk landed.
    expect(server.puts.filter((p) => p === 0)).toHaveLength(1)
  })

  it("a stored chunk whose reply was lost is not sent again after resync", async () => {
    const server = fakeServer(8192, 4096)
    server.loseNextResponse()
    await runResumableUpload({ file: source(8192), meta: meta(8192), transport: server.transport, sleep: async () => {} })
    expect(server.puts).toEqual([0, 4096])
  })

  it("follows the server when it reports a different offset", async () => {
    const server = fakeServer(12_288, 4096)
    server.offset = 8192 // the server already has two chunks (e.g. after a reload)
    const done = await runResumableUpload({ file: source(12_288), meta: meta(12_288), transport: server.transport, sleep: async () => {} })
    expect(done.status).toBe("COMPLETE")
    expect(server.puts).toEqual([8192])
  })

  it("gives up as 'stalled' after five failures — progress kept for Resume", async () => {
    const server = fakeServer(8192, 4096)
    server.failFor(100)
    await expect(
      runResumableUpload({ file: source(8192), meta: meta(8192), transport: server.transport, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(UploadStalledError)
  })

  it("does not retry what cannot succeed (expired, revoked, too large)", async () => {
    const server = fakeServer(8192, 4096)
    let calls = 0
    await expect(
      runResumableUpload({
        file: source(8192),
        meta: meta(8192),
        transport: {
          ...server.transport,
          putChunk: async () => {
            calls += 1
            throw new UploadHttpError(410, "UPLOAD_SESSION_EXPIRED", "expired")
          },
        },
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_SESSION_EXPIRED" })
    expect(calls).toBe(1)
  })

  it("pausing stops between chunks without losing the session", async () => {
    const server = fakeServer(16_384, 4096)
    const controller = new AbortController()
    await expect(
      runResumableUpload({
        file: source(16_384),
        meta: meta(16_384),
        transport: {
          ...server.transport,
          putChunk: async (args) => {
            const r = await server.transport.putChunk(args)
            if (args.offset === 4096) controller.abort(new UploadPausedError())
            return r
          },
        },
        signal: controller.signal,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(UploadPausedError)
    expect(server.offset).toBe(8192)
    // Resume picks up at 8192.
    const done = await runResumableUpload({ file: source(16_384), meta: meta(16_384), transport: server.transport, knownUploadId: "u1", sleep: async () => {} })
    expect(done.status).toBe("COMPLETE")
    expect(server.puts.slice(-2)).toEqual([8192, 12_288])
  })
})
