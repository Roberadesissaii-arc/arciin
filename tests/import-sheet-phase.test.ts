import { describe, expect, it } from "vitest"

import type { ImportInspection } from "@arciin/shared"

import { importSheetPhase } from "../apps/web/lib/utils/import-sheet-phase"
import { analyzeImportLink } from "../apps/web/lib/utils/link-import-preview"

/** Every state of the Import from link sheet has its own words; none spins forever. */

const base = { text: "example.com", normalizedOk: true, clientBlocked: false, settled: true, inspection: undefined, inspecting: false, inspectFailed: false }
const inspection = (over: Partial<ImportInspection>): ImportInspection => ({
  inspectionId: "i".repeat(24),
  url: "https://example.com/",
  kind: "single",
  title: null,
  items: [],
  reason: null,
  ...over,
})
const item = (id: string) => ({ id, url: `https://cdn.example.com/${id}.mp4`, title: id, hasThumbnail: false, durationSeconds: null, source: "cdn.example.com", category: "video" as const })

describe("importSheetPhase", () => {
  it("walks empty → preparing → inspecting → result", () => {
    expect(importSheetPhase({ ...base, text: "" })).toBe("empty")
    expect(importSheetPhase({ ...base, settled: false })).toBe("preparing")
    expect(importSheetPhase({ ...base, inspecting: true })).toBe("inspecting")
    expect(importSheetPhase({ ...base, inspection: inspection({ kind: "single", items: [item("c1")] }) })).toBe("single")
    expect(importSheetPhase({ ...base, inspection: inspection({ kind: "collection", items: [item("c1"), item("c2")] }) })).toBe("multiple")
    expect(importSheetPhase({ ...base, inspection: inspection({ kind: "none" }) })).toBe("none")
    expect(importSheetPhase({ ...base, inspection: inspection({ kind: "blocked", reason: "DRM" }) })).toBe("blocked")
    expect(importSheetPhase({ ...base, inspectFailed: true })).toBe("error")
  })

  it("a private address refused by the server is blocked, with its reason — not a vague error", () => {
    expect(importSheetPhase({ ...base, inspectFailed: true, inspectRefused: true })).toBe("blocked")
  })

  it("input that is not a link is invalid, not inspected", () => {
    expect(importSheetPhase({ ...base, text: "javascript:alert(1)", normalizedOk: false })).toBe("invalid")
  })

  it("DRM hosts are blocked at once, without waiting for the server", () => {
    expect(importSheetPhase({ ...base, clientBlocked: true, settled: false })).toBe("blocked")
  })
})

describe("client-side DRM rules still hold on normalised links", () => {
  it.each(["https://open.spotify.com/track/abc", "https://www.audible.com/pd/x"])("%s is blocked", (url) => {
    expect(analyzeImportLink(url)?.importBlocked).toBe(true)
  })
  it.each(["https://www.youtube.com/watch?v=abc", "https://soundcloud.com/a/b", "https://www.tiktok.com/@a/video/1", "https://vimeo.com/1", "https://example.com/a.mp4", "https://example.com/doc.pdf", "https://example.com/p.jpg"])(
    "%s is not blocked",
    (url) => {
      expect(analyzeImportLink(url)?.importBlocked).toBe(false)
    },
  )
})
