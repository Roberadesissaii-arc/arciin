import { describe, expect, it } from "vitest"

import { buildVisibleAssetWhere } from "../apps/api/src/services/libraries/visible-asset-query"

/**
 * A search box is not a pattern language.
 *
 * Prisma's `contains` becomes SQL LIKE, so `%` and `_` kept their wildcard
 * meaning: a literal "%" matched 264 of 266 assets in a real library. Values
 * were always parameterised — this was never injection — it was simply the
 * wrong answer to what the reader typed.
 */
type ContainsClause = { OR?: Array<Record<string, { contains?: string }>> }

/** The search OR, not the folder-visibility OR that sits beside it. */
function searchClause(search: string): ContainsClause | undefined {
  const where = buildVisibleAssetWhere({ scope: { kind: "all" }, search }) as {
    AND?: ContainsClause[]
  }
  return (where.AND ?? []).find((c) =>
    (c.OR ?? []).some((o) => Object.values(o)[0]?.contains !== undefined),
  )
}

function searchTerms(search: string): string[] {
  return (searchClause(search)?.OR ?? []).map((o) => Object.values(o)[0]?.contains ?? "")
}

describe("literal search", () => {
  it("escapes the LIKE wildcards", () => {
    expect(searchTerms("%")).toEqual(["\\%", "\\%"])
    expect(searchTerms("_")).toEqual(["\\_", "\\_"])
  })

  it("escapes the escape character itself, and does so first", () => {
    // Not "\\\\%" — the backslash must not end up escaping the escape.
    expect(searchTerms("\\")).toEqual(["\\\\", "\\\\"])
    expect(searchTerms("100%\\_x")).toEqual(["100\\%\\\\\\_x", "100\\%\\\\\\_x"])
  })

  it("leaves an ordinary phrase untouched", () => {
    expect(searchTerms("Atlantis Gene")).toEqual(["Atlantis Gene", "Atlantis Gene"])
  })

  it("leaves Unicode untouched", () => {
    expect(searchTerms("café 日本")).toEqual(["café 日本", "café 日本"])
  })

  it("searches both the filename and the title", () => {
    expect(searchClause("x")?.OR?.map((o) => Object.keys(o)[0])).toEqual([
      "originalFilename",
      "title",
    ])
  })
})
