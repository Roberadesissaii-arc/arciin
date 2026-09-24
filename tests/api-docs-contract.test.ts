import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The developer docs state the success codes the API really returns.
 *
 * An external integration asked whether 201 on create was a bug. It is not —
 * it is the contract — so it is written down, and pinned here next to the
 * routes that produce it so the two cannot drift apart.
 */
const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8")
const manual = read("apps/web/components/docs/documentation-manual.tsx")
const apiMd = read("docs/API.md")

describe("documented success codes match the routes", () => {
  it.each([
    ["apps/api/src/modules/uploads/routes.ts", "/uploads"],
    ["apps/api/src/modules/app-databases/routes.ts", "/app-databases"],
  ])("%s still answers 201 on create", (file) => {
    expect(read(file)).toContain("reply.status(201)")
  })

  it("the manual states 201 for uploads, databases, tables and rows", () => {
    expect(manual).toMatch(/"POST",\s+"\/app-databases",\s+"[^"]*201 Created"/)
    expect(manual).toMatch(/"POST",\s+"\/app-databases\/:id\/tables",\s+"[^"]*201 Created"/)
    expect(manual).toMatch(/"POST",\s+"\/app-database-tables\/:tableId\/rows",\s+"[^"]*201 Created"/)
    expect(manual).toMatch(/path="\/uploads"\s+desc="[^"]*201 Created/)
  })

  it("the manual documents PATCH merge and PUT replace", () => {
    expect(manual).toContain('"PUT",    "/app-database-rows/:rowId"')
    expect(manual).toContain("PATCH merges, PUT replaces")
  })

  it("error codes in the docs are the codes the API sends", () => {
    expect(manual).not.toMatch(/"code": "UNAUTHORIZED"/)
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN", "RATE_LIMITED", "VALIDATION_ERROR"]) {
      expect(manual).toContain(code)
      expect(apiMd).toContain(code)
    }
  })
})
