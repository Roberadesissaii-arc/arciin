import { describe, expect, it } from "vitest"

import {
  parseAssistantAnnotations,
  normalizeNoteKind,
  stripNoteTags,
} from "@/lib/files/parse-pdf-annotations"
import {
  arrowPath,
  layoutPageAnnotations,
  measureNote,
  wrapNoteText,
  type PageGeometry,
  type PdfPageAnnotation,
} from "@/lib/files/pdf-annotation-layout"
import type { PdfHighlightRect } from "@/lib/files/pdf-highlight-types"

/**
 * The assistant writing on the page like a tutor with a pencil.
 *
 * The risk this feature carries is not that a note is missing — it is that a
 * note lands on top of the paragraph it was explaining, so the page is worse
 * than it was clean. Placement is therefore pure and asserted here.
 */

// An A4-ish page with generous margins, like the photosynthesis handout.
const PAGE: PageGeometry = {
  width: 800,
  height: 1130,
  contentLeft: 90,
  contentRight: 560,
  contentTop: 80,
  contentBottom: 1000,
}

const rect = (top: number, left = 100, width = 300, height = 16): PdfHighlightRect => ({
  left,
  top,
  width,
  height,
})

function note(id: string, text: string, kind: PdfPageAnnotation["kind"] = "note"): PdfPageAnnotation {
  return { id, page: 2, kind, text, target: "t" }
}

describe("reading notes out of a reply", () => {
  it("parses a note with its target and kind", () => {
    const out = parseAssistantAnnotations(
      '[note:important:"RuBisCO grabs CO":"CO2 is fixed here!"]',
      { page: 2 },
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      page: 2,
      kind: "important",
      target: "RuBisCO grabs CO",
      text: "CO2 is fixed here!",
    })
  })

  it.each([
    ["note", "note"],
    ["arrow_note", "note"],
    ["important", "important"],
    ["key", "important"],
    ["warning", "warning"],
    ["definition", "definition"],
    ["def", "definition"],
    ["connection", "connection"],
    ["summary", "summary"],
    ["nonsense", "note"],
  ])("maps kind %j to %j", (given, want) => {
    expect(normalizeNoteKind(given)).toBe(want)
  })

  it("parses several notes in one reply", () => {
    const reply = [
      'Here is what matters on this page.',
      '[note:important:"does not run in the dark":"Depends on Stage 1!"]',
      '[note:note:"RuBisCO grabs CO":"CO2 is fixed here!"]',
      '[note:connection:"glyceraldehyde-3-phosphate":"Used to make sugars!"]',
      '[note:summary:"":"Basically: CO2 to G3P to sugars"]',
    ].join("\n")
    const out = parseAssistantAnnotations(reply, { page: 2 })
    expect(out).toHaveLength(4)
    expect(out.map((n) => n.kind)).toEqual(["important", "note", "connection", "summary"])
    expect(out[3]!.target).toBe("")
  })

  it("accepts single quotes", () => {
    expect(parseAssistantAnnotations("[note:note:'target':'text']", { page: 1 })[0]!.text).toBe("text")
  })

  it("accepts a tag with the kind left out", () => {
    const out = parseAssistantAnnotations('[note:"RuBisCO":"fixes CO2"]', { page: 1 })
    expect(out[0]).toMatchObject({ kind: "note", target: "RuBisCO", text: "fixes CO2" })
  })

  it("does not repeat an identical note", () => {
    const out = parseAssistantAnnotations(
      '[note:note:"a":"same"] [note:note:"a":"same"]',
      { page: 1 },
    )
    expect(out).toHaveLength(1)
  })

  it("caps how many notes one reply can add", () => {
    const many = Array.from({ length: 20 }, (_, i) => `[note:note:"t${i}":"n${i}"]`).join(" ")
    expect(parseAssistantAnnotations(many, { page: 1 }).length).toBeLessThanOrEqual(8)
  })

  it("truncates a note that is really a paragraph", () => {
    const long = "x".repeat(400)
    expect(parseAssistantAnnotations(`[note:note:"t":"${long}"]`, { page: 1 })[0]!.text.length)
      .toBeLessThanOrEqual(160)
  })

  it("removes every note tag from what the student reads", () => {
    const raw = 'I marked four things. [note:important:"a":"b"] [note:summary:"":"c"] Done.'
    expect(stripNoteTags(raw).replace(/\s+/g, " ").trim()).toBe("I marked four things. Done.")
  })

  it("ignores a reply with no tags", () => {
    expect(parseAssistantAnnotations("Carbon fixation is the first phase.", { page: 1 })).toEqual([])
  })
})

describe("wrapping handwriting", () => {
  it("keeps notes to short lines", () => {
    expect(wrapNoteText("CO2 is fixed here!", 8)).toEqual(["CO2 is", "fixed", "here!"])
  })

  it("honours line breaks the assistant wrote", () => {
    expect(wrapNoteText("Depends on\nStage 1!", 40)).toEqual(["Depends on", "Stage 1!"])
  })

  it("measures taller for more lines", () => {
    const short = measureNote("Key idea", 200)
    const long = measureNote("Key idea that runs on much longer than the first one does", 200)
    expect(long.height).toBeGreaterThan(short.height)
  })
})

describe("placing notes in the margin", () => {
  it("puts a note in the whitespace, never over the text column", () => {
    const [placed] = layoutPageAnnotations([{ ...note("a", "CO2 is fixed here!"), rect: rect(400) }], PAGE)
    expect(placed!.box.left).toBeGreaterThanOrEqual(PAGE.contentRight)
    expect(placed!.box.left + placed!.box.width).toBeLessThanOrEqual(PAGE.width)
  })

  it("lines the note up with what it explains", () => {
    const [placed] = layoutPageAnnotations([{ ...note("a", "Key"), rect: rect(400) }], PAGE)
    expect(Math.abs(placed!.box.top - 400)).toBeLessThan(40)
  })

  it("never overlaps two notes", () => {
    const placed = layoutPageAnnotations(
      [
        { ...note("a", "Depends on Stage 1!"), rect: rect(400) },
        { ...note("b", "CO2 is fixed here!"), rect: rect(410) },
        { ...note("c", "Used to make sugars!"), rect: rect(415) },
      ],
      PAGE,
    )
    expect(placed).toHaveLength(3)
    const sorted = [...placed].sort((a, b) => a.box.top - b.box.top)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      if (prev.side !== cur.side) continue
      expect(cur.box.top).toBeGreaterThanOrEqual(prev.box.top + prev.height)
    }
  })

  it("stays inside the page", () => {
    const placed = layoutPageAnnotations(
      Array.from({ length: 6 }, (_, i) => ({
        ...note(`n${i}`, "A note that takes a couple of lines to write out"),
        rect: rect(200 + i * 12),
      })),
      PAGE,
    )
    for (const p of placed) {
      expect(p.box.top).toBeGreaterThanOrEqual(0)
      expect(p.box.top + p.height).toBeLessThanOrEqual(PAGE.height)
    }
  })

  it("uses the left margin when the right one is full", () => {
    const placed = layoutPageAnnotations(
      Array.from({ length: 14 }, (_, i) => ({
        ...note(`n${i}`, "Another explanation written in the margin here"),
        rect: rect(100 + i * 8),
      })),
      { ...PAGE, height: 500 },
    )
    expect(new Set(placed.map((p) => p.side)).size).toBe(2)
  })

  it("orders notes down the page, not in the order the model wrote them", () => {
    const placed = layoutPageAnnotations(
      [
        { ...note("late", "Written last"), rect: rect(800) },
        { ...note("early", "Written first"), rect: rect(200) },
      ],
      PAGE,
    )
    expect(placed[0]!.id).toBe("early")
  })

  it("drops a note it cannot place rather than covering the text", () => {
    const tiny: PageGeometry = { ...PAGE, height: 90 }
    const placed = layoutPageAnnotations(
      Array.from({ length: 8 }, (_, i) => ({
        ...note(`n${i}`, "A fairly long note that needs several lines to write"),
        rect: rect(20 + i * 4),
      })),
      tiny,
    )
    expect(placed.length).toBeLessThan(8)
    for (const p of placed) expect(p.box.top + p.height).toBeLessThanOrEqual(tiny.height)
  })

  it("gives a summary no arrow and puts it low on the page", () => {
    const [placed] = layoutPageAnnotations(
      [{ ...note("s", "Basically: CO2 to G3P to sugars", "summary"), rect: null }],
      PAGE,
    )
    expect(placed!.arrow).toBeNull()
    expect(placed!.box.top).toBeGreaterThan(PAGE.height / 2)
  })

  it("still places a note on a page with no usable margin", () => {
    const edgeToEdge: PageGeometry = { ...PAGE, contentLeft: 4, contentRight: 796 }
    const placed = layoutPageAnnotations([{ ...note("a", "Key idea"), rect: rect(300) }], edgeToEdge)
    expect(placed).toHaveLength(1)
  })
})

describe("the arrow reaches what the note explains", () => {
  it("ends on the target", () => {
    const target = rect(400, 100, 300, 16)
    const [placed] = layoutPageAnnotations([{ ...note("a", "CO2 is fixed here!"), rect: target }], PAGE)
    const end = placed!.arrow!.at(-1)!
    expect(end.y).toBeCloseTo(target.top + target.height / 2, 0)
    // Approaches the text from the margin the note sits in.
    expect(end.x).toBeGreaterThanOrEqual(target.left)
  })

  it("starts at the note", () => {
    const [placed] = layoutPageAnnotations([{ ...note("a", "Key idea"), rect: rect(400) }], PAGE)
    const start = placed!.arrow![0]!
    expect(Math.abs(start.y - (placed!.box.top + placed!.height / 2))).toBeLessThan(2)
  })

  it("bows rather than running straight", () => {
    const path = arrowPath({ x: 600, y: 100 }, { x: 300, y: 200 }, "right")
    const [from, mid, to] = path as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
    const straightY = (from.y + to.y) / 2
    const straightX = (from.x + to.x) / 2
    expect(Math.abs(mid.x - straightX) + Math.abs(mid.y - straightY)).toBeGreaterThan(1)
  })

  it("draws the same arrow every time, so it does not move while being read", () => {
    const a = arrowPath({ x: 600, y: 100 }, { x: 300, y: 200 }, "right")
    const b = arrowPath({ x: 600, y: 100 }, { x: 300, y: 200 }, "right")
    expect(a).toEqual(b)
  })

  it("bows away from the text on each side", () => {
    const right = arrowPath({ x: 600, y: 100 }, { x: 300, y: 100 }, "right")
    const left = arrowPath({ x: 60, y: 100 }, { x: 300, y: 100 }, "left")
    expect(right[1]!.x).toBeGreaterThan((600 + 300) / 2)
    expect(left[1]!.x).toBeLessThan((60 + 300) / 2)
  })
})
