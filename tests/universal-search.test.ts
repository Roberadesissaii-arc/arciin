import { describe, expect, it } from "vitest"

import {
  UNIVERSAL_SEARCH_LIMITS,
  UNIVERSAL_SEARCH_SEMANTIC_RESERVE,
  folderMatchTier,
  navigationMatchScore,
  normalizeUniversalQuery,
  rankNavigation,
  rankUniversalFiles,
  rankUniversalFolders,
} from "@arciin/shared"

import {
  allFilesSearchHref,
  fileContainerHref,
  fileContextLine,
  fileHref,
  folderHref,
  formatDuration,
  libraryHref,
} from "../apps/web/lib/universal-search-routes"

const file = (id: string, originalFilename: string, title: string | null = null) => ({ id, originalFilename, title })

describe("normalizeUniversalQuery", () => {
  it("trims, collapses whitespace, strips control characters and bounds length", () => {
    expect(normalizeUniversalQuery("  birthday \n\t party  ")).toBe("birthday party")
    expect(normalizeUniversalQuery("a\u0000b")).toBe("a b")
    expect(normalizeUniversalQuery("x".repeat(500))).toHaveLength(200)
    expect(normalizeUniversalQuery(undefined)).toBe("")
    expect(normalizeUniversalQuery(42)).toBe("")
  })
})

describe("rankUniversalFiles", () => {
  it("orders exact, then prefix, then contains, then meaning — and labels only meaning", () => {
    const literal = [
      file("contains", "my-report-final.pdf"),
      file("prefix", "report 2026.pdf"),
      file("exact", "report.pdf"),
    ]
    const semantic = [{ item: file("meaning", "IMG_0042.jpg"), score: 0.8 }]
    const ranked = rankUniversalFiles("report", literal, semantic)
    expect(ranked.map((r) => r.item.id)).toEqual(["exact", "prefix", "contains", "meaning"])
    expect(ranked.map((r) => r.match.kind)).toEqual(["exact", "literal", "literal", "semantic"])
    expect(ranked[3]!.match.label).toBe("Matched by meaning")
    expect(ranked.slice(0, 3).every((r) => r.match.label === null)).toBe(true)
  })

  it("a weaker meaning match is 'Related by meaning'; no score is ever exposed", () => {
    const ranked = rankUniversalFiles("party", [], [{ item: file("a", "IMG_1.jpg"), score: 0.64 }])
    expect(ranked[0]!.match).toEqual({ kind: "semantic", label: "Related by meaning" })
    expect(JSON.stringify(ranked)).not.toMatch(/0\.64|score/)
  })

  it("keeps a few slots for meaning when keyword hits alone would fill the panel", () => {
    const literal = Array.from({ length: 20 }, (_, i) => file(`l${i}`, `party-${i}.jpg`))
    const semantic = Array.from({ length: 5 }, (_, i) => ({ item: file(`s${i}`, `IMG_${i}.jpg`), score: 0.9 - i / 100 }))
    const ranked = rankUniversalFiles("party", literal, semantic)
    expect(ranked).toHaveLength(UNIVERSAL_SEARCH_LIMITS.files)
    const kinds = ranked.map((r) => r.match.kind)
    expect(kinds.filter((k) => k === "semantic")).toHaveLength(UNIVERSAL_SEARCH_SEMANTIC_RESERVE)
    // Meaning still never outranks a keyword hit.
    expect(kinds.lastIndexOf("literal")).toBeLessThan(kinds.indexOf("semantic"))
  })

  it("fills unused meaning slots with keyword hits, and unused keyword slots with meaning", () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`l${i}`, `doc-${i}.pdf`))
    expect(rankUniversalFiles("doc", many, [])).toHaveLength(UNIVERSAL_SEARCH_LIMITS.files)
    const meaning = Array.from({ length: 12 }, (_, i) => ({ item: file(`s${i}`, `x${i}`), score: 0.7 }))
    expect(rankUniversalFiles("doc", [file("one", "doc.pdf")], meaning)).toHaveLength(UNIVERSAL_SEARCH_LIMITS.files)
  })

  it("never lists the same file twice", () => {
    const shared = file("same", "party.jpg")
    const ranked = rankUniversalFiles("party", [shared], [{ item: shared, score: 0.9 }])
    expect(ranked.map((r) => r.item.id)).toEqual(["same"])
  })
})

describe("folder ranking", () => {
  it("tiers: exact name, prefix, contains, path only", () => {
    expect(folderMatchTier("movies", { name: "Movies", pathCache: "/movies" })).toBe(4)
    expect(folderMatchTier("mov", { name: "Movies", pathCache: "/movies" })).toBe(3)
    expect(folderMatchTier("show", { name: "TV Shows", pathCache: "/tv-shows" })).toBe(2)
    expect(folderMatchTier("movies", { name: "2026", pathCache: "/movies/2026" })).toBe(1)
    expect(folderMatchTier("zzz", { name: "Movies", pathCache: "/movies" })).toBe(0)
  })

  it("best tier first, shallower before deeper, bounded", () => {
    const folders = [
      { name: "2026", pathCache: "/wedding/2026" },
      { name: "Wedding photos", pathCache: "/archive/wedding-photos" },
      { name: "Wedding", pathCache: "/wedding" },
      { name: "Unrelated", pathCache: "/x" },
    ]
    expect(rankUniversalFolders("wedding", folders).map((f) => f.name)).toEqual(["Wedding", "Wedding photos", "2026"])
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Album ${i}`, pathCache: `/album-${i}` }))
    expect(rankUniversalFolders("album", many)).toHaveLength(UNIVERSAL_SEARCH_LIMITS.folders)
  })
})

describe("navigation ranking", () => {
  const nav = [
    { title: "Overview", keywords: ["home", "dashboard"] },
    { title: "AI Chat", keywords: ["assistant"] },
    { title: "All Files" },
    { title: "Settings", keywords: ["preferences"] },
    { title: "Database", keywords: ["storage audit"] },
  ]

  it("matches titles, words in titles and aliases", () => {
    expect(rankNavigation("set", nav).map((n) => n.title)).toEqual(["Settings"])
    expect(rankNavigation("chat", nav).map((n) => n.title)).toEqual(["AI Chat"])
    expect(rankNavigation("home", nav).map((n) => n.title)).toEqual(["Overview"])
    expect(rankNavigation("storage", nav).map((n) => n.title)).toEqual(["Database"])
    expect(rankNavigation("nothing-here", nav)).toEqual([])
  })

  it("title beats alias", () => {
    expect(navigationMatchScore("files", { title: "All Files" })).toBeGreaterThan(
      navigationMatchScore("files", { title: "Database", keywords: ["files"] }),
    )
  })
})

describe("result destinations", () => {
  const lib = (slug: string, name = slug) => ({ id: "l", name, slug, kind: "IMAGE" })

  it("library pages, folder pages where they exist, and All Files otherwise", () => {
    expect(libraryHref("videos")).toBe("/videos")
    expect(libraryHref("inbox")).toBe("/inbox")
    expect(libraryHref("custom-lib")).toBe("/files")
    expect(folderHref({ slug: "tv-shows", library: { slug: "videos" } })).toBe("/videos/tv-shows")
    // Inbox has no folder pages.
    expect(folderHref({ slug: "misc", library: { slug: "inbox" } })).toBe("/inbox")
  })

  it("files open where they are listed, with ?asset= for the inspector", () => {
    const inFolder = { id: "a1", library: lib("images", "Images"), folder: { id: "f", name: "Family", slug: "family" } }
    expect(fileHref(inFolder)).toBe("/images/family?asset=a1")
    expect(fileContainerHref(inFolder)).toBe("/images/family")
    expect(fileHref({ id: "a 2", library: lib("documents"), folder: null })).toBe("/documents?asset=a%202")
    expect(fileHref({ id: "a3", library: null, folder: null })).toBe("/files?asset=a3")
    expect(allFilesSearchHref("birthday party")).toBe("/files?q=birthday%20party")
  })

  it("context line and duration", () => {
    expect(
      fileContextLine({ mediaType: "IMAGE", extension: "jpg", library: lib("images", "Images"), folder: { id: "f", name: "Family", slug: "family" } }),
    ).toBe("JPG · Images · Family")
    expect(fileContextLine({ mediaType: "OTHER", extension: null, library: null, folder: null })).toBe("File")
    expect(formatDuration(65)).toBe("1:05")
    expect(formatDuration(3725)).toBe("1:02:05")
    expect(formatDuration(0)).toBeNull()
  })
})
