import { describe, expect, it } from "vitest"

import { extractBlockMath, readMathBlockPlaceholder } from "@arciin/shared"

import { sanitizeCanvasDocument } from "@/components/chat/chat-canvas-helpers"

/**
 * The whole canvas chain, on the text the canvas actually receives.
 *
 * The pure splitter was already tested in isolation, which proved nothing about
 * whether the canvas reaches it with the LaTeX intact: `sanitizeCanvasDocument`
 * runs first and rewrites the document to strip tool calls and preambles. This
 * test covers the join between them.
 */

const CANVAS_SAMPLE = [
  "# Astrophysics review",
  "",
  "## 3.2 The Radiation Laws",
  "",
  "The second radiation law receives equally careful treatment:",
  "",
  "\\[",
  "",
  "F = \\sigma T^4",
  "",
  "\\]",
  "",
  "Here, \\(F\\) is the energy flux emitted by a blackbody.",
  "",
  "The authors then combine this with the surface area of a sphere:",
  "",
  "\\[",
  "L = 4\\pi R^2 \\sigma T^4",
  "\\]",
].join("\n")

describe("canvas document → math extraction", () => {
  const sanitized = sanitizeCanvasDocument(CANVAS_SAMPLE)

  it("sanitising the canvas document leaves the LaTeX delimiters intact", () => {
    expect(sanitized).toContain("\\[")
    expect(sanitized).toContain("\\]")
    expect(sanitized).toContain("F = \\sigma T^4")
  })

  it("finds both display equations after sanitising", () => {
    const result = extractBlockMath(sanitized)
    expect(result.blocks).toEqual(["F = \\sigma T^4", "L = 4\\pi R^2 \\sigma T^4"])
  })

  it("leaves no bare delimiter behind for the renderer to print as text", () => {
    // The reported symptom was literally seeing "\[" and "\]" as paragraphs.
    const result = extractBlockMath(sanitized)
    const stray = result.text
      .split("\n")
      .filter((line) => line.trim() === "\\[" || line.trim() === "\\]")
    expect(stray).toEqual([])
  })

  it("replaces each equation with exactly one placeholder line", () => {
    const result = extractBlockMath(sanitized)
    const placeholders = result.text
      .split("\n")
      .map(readMathBlockPlaceholder)
      .filter((index) => index !== null)
    expect(placeholders).toEqual([0, 1])
  })

  it("keeps the surrounding prose and headings", () => {
    const result = extractBlockMath(sanitized)
    expect(result.text).toContain("## 3.2 The Radiation Laws")
    expect(result.text).toContain("Here, \\(F\\) is the energy flux")
  })

  it("survives the blank lines the model puts inside the delimiters", () => {
    // The reported output had an empty line after \[ and before \]; collapsing
    // those must not break the match.
    const withBlanks = extractBlockMath(sanitizeCanvasDocument("\\[\n\n x = 1 \n\n\\]"))
    expect(withBlanks.blocks).toEqual(["x = 1"])
  })
})

describe("canvas tables", () => {
  // Canvas never handled pipe tables, so a medication schedule — exactly the
  // kind of document Canvas exists for — rendered as a run of paragraphs
  // starting with "|", separator row and all.
  const TABLE = [
    "## 1. The Four Medications",
    "",
    "| Medication | Strength | Daily Frequency |",
    "|---|---|---|",
    "| Tetracycline | 500 MG | 4 times |",
    "| Bismuth | 262 MG | 4 times |",
    "",
    "**Duration:** 14 consecutive days.",
  ].join("\n")

  it("leaves the table rows intact through canvas sanitising", () => {
    const sanitized = sanitizeCanvasDocument(TABLE)
    expect(sanitized).toContain("| Tetracycline | 500 MG | 4 times |")
    expect(sanitized).toContain("|---|---|---|")
  })

  it("keeps the separator row adjacent to the header", () => {
    // The header is only a header because a separator follows it directly;
    // collapsing blank lines must not move them apart.
    const lines = sanitizeCanvasDocument(TABLE).split("\n")
    const headerAt = lines.findIndex((l) => l.includes("Medication | Strength"))
    expect(lines[headerAt + 1]).toMatch(/^\|[-|]+\|$/)
  })

  it("does not mistake a table row for math or a list", () => {
    const result = extractBlockMath(sanitizeCanvasDocument(TABLE))
    expect(result.blocks).toEqual([])
    expect(result.text).toContain("| Bismuth | 262 MG | 4 times |")
  })
})
