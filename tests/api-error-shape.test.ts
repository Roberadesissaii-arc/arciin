import { describe, expect, it } from "vitest"

/**
 * What a failure is allowed to tell the caller.
 *
 * A duplicate folder name used to answer 500 with the raw Prisma invocation:
 * the failing call, the surrounding source lines with their variable names,
 * and the constraint `(libraryId, pathCache)`. That is a schema map handed to
 * anyone who can trip a constraint — and the status was wrong too, because a
 * name already taken is a conflict the caller can fix, not a server fault.
 *
 * A rejected cross-origin request had the opposite problem: correctly blocked,
 * but reported as 500 SERVER_ERROR because @fastify/cors rejects with a bare
 * Error carrying no statusCode.
 */

const SOURCE = "apps/api/src/plugins/error-handler.ts"

async function readHandler() {
  const { readFileSync } = await import("node:fs")
  const path = await import("node:path")
  return readFileSync(path.resolve(__dirname, "..", SOURCE), "utf8")
}

describe("database errors are translated, never forwarded", () => {
  it("maps a unique conflict to 409, not 500", async () => {
    const src = await readHandler()
    expect(src).toMatch(/case "P2002":/)
    expect(src).toMatch(/status: 409/)
    expect(src).toMatch(/ALREADY_EXISTS/)
  })

  it("maps a missing row to 404 and a foreign-key clash to 409", async () => {
    const src = await readHandler()
    expect(src).toMatch(/case "P2025":[\s\S]{0,120}404/)
    expect(src).toMatch(/case "P2003":[\s\S]{0,120}409/)
  })

  it("falls back to a generic 500 for database codes it does not know", async () => {
    const src = await readHandler()
    expect(src).toMatch(/default:[\s\S]{0,200}DATABASE_ERROR/)
    expect(src).toMatch(/An unexpected error occurred\./)
  })

  it("never sends the ORM's own message or code to the caller", async () => {
    const src = await readHandler()
    // The Prisma branch must return a mapped shape and stop.
    const branch = src.slice(src.indexOf("if (isPrismaError(error))"))
    expect(branch).toMatch(/code: mapped\.code, message: mapped\.message/)
    expect(branch).not.toMatch(/message: error\.message/)
  })

  it("keeps the detail server-side, tied to a request id", async () => {
    const src = await readHandler()
    expect(src).toMatch(/fastify\.log\.error\([\s\S]{0,160}prismaCode/)
    expect(src).toMatch(/requestId: request\.id/)
  })
})

describe("a refused origin is a refusal, not a crash", () => {
  it("answers 403 with its own code", async () => {
    const src = await readHandler()
    expect(src).toMatch(/Origin not allowed/)
    expect(src).toMatch(/status\(403\)/)
    expect(src).toMatch(/ORIGIN_NOT_ALLOWED/)
  })

  it("records the blocked origin for the security log", async () => {
    const src = await readHandler()
    expect(src).toMatch(/fastify\.log\.warn\([\s\S]{0,140}origin/)
  })
})

describe("filesystem paths stay redacted", () => {
  it("still sanitises paths on the generic branch", async () => {
    const src = await readHandler()
    expect(src).toMatch(/sanitizePaths\(/)
    expect(src).toMatch(/\[path redacted\]/)
  })
})
