import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { markdownToPdfBytes } from "@/lib/chat/canvas-export"
import { readTrueTypeMetrics } from "@/lib/chat/truetype-metrics"

/**
 * Handwriting in an exported PDF.
 *
 * The fourteen fonts every reader ships with are serif, sans or mono, so a hand
 * has to be embedded — and embedded with a Widths array, because a reader lays
 * text out from the numbers the document declares rather than by measuring the
 * font. Without them every glyph draws at a default advance and the line bunches
 * up or crawls apart.
 */

const FONT = new Uint8Array(
  readFileSync("apps/web/public/fonts/caveat/Caveat-Regular.ttf"),
)
const MARKDOWN = "# Neurons\n\nA neuron carries signals.\n\n## Structure\n\nDendrites receive them."

describe("reading the font's metrics", () => {
  const metrics = readTrueTypeMetrics(FONT)

  it("parses the real file", () => {
    expect(metrics).not.toBeNull()
  })

  it("reads a sane design grid", () => {
    expect(metrics!.unitsPerEm).toBeGreaterThan(0)
    expect(metrics!.ascent).toBeGreaterThan(0)
    expect(metrics!.descent).toBeLessThan(0)
  })

  it("gives every printable ASCII character a width", () => {
    const missing = []
    for (let code = 33; code <= 126; code++) {
      if (!metrics!.widths.get(code)) missing.push(code)
    }
    expect(missing).toEqual([])
  })

  it("reads proportional widths, not a fixed guess", () => {
    // If these came out equal the parser would be returning a default rather
    // than reading hmtx, and the layout would be wrong in a way that still
    // looks plausible.
    const i = metrics!.widths.get("i".charCodeAt(0))!
    const m = metrics!.widths.get("m".charCodeAt(0))!
    expect(i).toBeLessThan(m)
  })

  it("refuses input that is not a font", () => {
    expect(readTrueTypeMetrics(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})

describe("the exported PDF", () => {
  const metrics = readTrueTypeMetrics(FONT)!
  const hand = markdownToPdfBytes("Neurons", MARKDOWN, { bytes: FONT, metrics })
  const text = Buffer.from(hand).toString("latin1")

  it("embeds the font file itself", () => {
    expect(text).toContain("/FontFile2")
    expect(text).toContain("/Subtype /TrueType")
    expect(hand.length).toBeGreaterThan(FONT.length)
  })

  it("declares the widths a reader needs to lay it out", () => {
    expect(text).toMatch(/\/Widths \[ [\d ]{40,}/)
    expect(text).toContain("/FirstChar 32")
    expect(text).toContain("/LastChar 255")
  })

  it("uses an encoding that matches the widths", () => {
    expect(text).toContain("/Encoding /WinAnsiEncoding")
  })

  it("does not quietly fall back to Times", () => {
    expect(text).not.toContain("Times-Roman")
  })

  it("is still a well-formed PDF", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true)
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(text).toContain("trailer")
  })

  it("leaves the plain export in Times and much smaller", () => {
    const plain = markdownToPdfBytes("Neurons", MARKDOWN)
    const plainText = Buffer.from(plain).toString("latin1")
    expect(plainText).toContain("Times-Roman")
    expect(plainText).not.toContain("/FontFile2")
    expect(plain.length).toBeLessThan(hand.length / 10)
  })
})
