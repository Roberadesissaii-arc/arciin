import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearStudyLayer,
  loadStudyLayer,
  saveStudyLayer,
} from "@/lib/files/pdf-study-layer-store"
import {
  layoutPageAnnotations,
  type PageGeometry,
  type PdfPageAnnotation,
} from "@/lib/files/pdf-annotation-layout"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/**
 * The study layer across reopens, and across every scale change.
 *
 * What is saved is text plus page, never geometry — so the layer survives zoom,
 * resize and a different machine by construction. These pin that property down,
 * because storing coordinates is the obvious shortcut and it breaks silently.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  })
})

const note = (over: Partial<PdfPageAnnotation> = {}): PdfPageAnnotation => ({
  id: "n1",
  page: 2,
  kind: "important",
  text: "Depends on Stage 1!",
  target: "does not run in the dark",
  ...over,
})

const mark = (over: Partial<PdfHighlightTarget> = {}): PdfHighlightTarget => ({
  page: 2,
  quote: "Carbon Fixation",
  kind: "heading",
  style: "circle",
  ...over,
})

describe("saving and restoring", () => {
  it("round-trips notes and marks", () => {
    saveStudyLayer("asset-1", { notes: [note()], marks: [mark()] })
    const back = loadStudyLayer("asset-1")
    expect(back!.notes[0]).toMatchObject({ text: "Depends on Stage 1!", page: 2 })
    expect(back!.marks[0]).toMatchObject({ quote: "Carbon Fixation", style: "circle" })
  })

  it("stores no geometry at all", () => {
    // The guarantee that makes zoom and resize safe: nothing positional is kept.
    saveStudyLayer("asset-1", { notes: [note()], marks: [mark()] })
    const raw = store.get("arciin.study-layer.asset-1")!
    for (const key of ["left", "top", "width", "height", "x", "y", "arrow", "rect"]) {
      expect(raw).not.toContain(`"${key}"`)
    }
  })

  it("keeps each document's layer separate", () => {
    saveStudyLayer("a", { notes: [note({ text: "A" })], marks: [] })
    saveStudyLayer("b", { notes: [note({ text: "B" })], marks: [] })
    expect(loadStudyLayer("a")!.notes[0]!.text).toBe("A")
    expect(loadStudyLayer("b")!.notes[0]!.text).toBe("B")
  })

  it("returns nothing for a document that was never annotated", () => {
    expect(loadStudyLayer("never-seen")).toBeNull()
  })

  it("clearing removes the entry rather than saving an empty one", () => {
    saveStudyLayer("asset-1", { notes: [note()], marks: [] })
    saveStudyLayer("asset-1", { notes: [], marks: [] })
    expect(store.has("arciin.study-layer.asset-1")).toBe(false)
    expect(loadStudyLayer("asset-1")).toBeNull()
  })

  it("clearStudyLayer removes it", () => {
    saveStudyLayer("asset-1", { notes: [note()], marks: [] })
    clearStudyLayer("asset-1")
    expect(loadStudyLayer("asset-1")).toBeNull()
  })
})

describe("a stored layer is untrusted input", () => {
  it.each([
    ["not json", "{{{"],
    ["not an object", '"hello"'],
    ["wrong version", JSON.stringify({ version: 99, notes: [], marks: [] })],
    ["null", "null"],
  ])("opens clean on %s", (_label, raw) => {
    store.set("arciin.study-layer.asset-1", raw)
    expect(() => loadStudyLayer("asset-1")).not.toThrow()
    expect(loadStudyLayer("asset-1")).toBeNull()
  })

  it("drops malformed entries but keeps the good ones", () => {
    store.set(
      "arciin.study-layer.asset-1",
      JSON.stringify({
        version: 1,
        savedAt: "now",
        notes: [note(), { id: "bad" }, null, { page: 0 }],
        marks: [mark(), { quote: "" }, { page: "two", quote: "x" }],
      }),
    )
    const back = loadStudyLayer("asset-1")!
    expect(back.notes).toHaveLength(1)
    expect(back.marks).toHaveLength(1)
  })

  it("caps how much one document can store", () => {
    const many = Array.from({ length: 200 }, (_, i) => note({ id: `n${i}` }))
    saveStudyLayer("asset-1", { notes: many, marks: [] })
    expect(loadStudyLayer("asset-1")!.notes.length).toBeLessThanOrEqual(60)
  })

  it("survives storage being unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("private mode")
        },
        setItem: () => {
          throw new Error("quota exceeded")
        },
        removeItem: () => {},
      },
    })
    expect(() => saveStudyLayer("a", { notes: [note()], marks: [] })).not.toThrow()
    expect(loadStudyLayer("a")).toBeNull()
  })
})

describe("placement follows the zoom", () => {
  // The viewer recomputes placement whenever the render width changes, so the
  // same note at 150% must land in the same place on the page, twice the size —
  // an arrow pointing at RuBisCO at 75% still points at it at 150%.
  const geometryAt = (scale: number): PageGeometry => ({
    width: 800 * scale,
    height: 1130 * scale,
    contentLeft: 90 * scale,
    contentRight: 560 * scale,
    contentTop: 80 * scale,
    contentBottom: 1000 * scale,
  })

  const rectAt = (scale: number) => ({
    left: 100 * scale,
    top: 400 * scale,
    width: 300 * scale,
    height: 16 * scale,
  })

  function place(scale: number) {
    return layoutPageAnnotations(
      [{ ...note({ kind: "note", text: "CO2 is fixed here!" }), rect: rectAt(scale) }],
      geometryAt(scale),
      15 * scale,
    )[0]!
  }

  it("keeps the note in the same relative position at 75% and 150%", () => {
    const small = place(1)
    const large = place(2)
    expect(large.box.left / large.box.top).toBeCloseTo(small.box.left / small.box.top, 1)
    // Same fraction across the page, not the same pixel count.
    expect(large.box.left / (800 * 2)).toBeCloseTo(small.box.left / 800, 2)
  })

  it("keeps the arrow on the same text at both scales", () => {
    const small = place(1)
    const large = place(2)
    const endSmall = small.arrow!.at(-1)!
    const endLarge = large.arrow!.at(-1)!
    expect(endLarge.x / (800 * 2)).toBeCloseTo(endSmall.x / 800, 2)
    expect(endLarge.y / (1130 * 2)).toBeCloseTo(endSmall.y / 1130, 2)
  })

  it("still fits inside the page when zoomed in", () => {
    const large = place(2)
    expect(large.box.left + large.box.width).toBeLessThanOrEqual(800 * 2)
    expect(large.box.top + large.height).toBeLessThanOrEqual(1130 * 2)
  })
})
