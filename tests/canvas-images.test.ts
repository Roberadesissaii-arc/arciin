import { describe, expect, it } from "vitest"

import {
  buildCanvasImageInstruction,
  findCanvasImageMarkers,
  stripCanvasImageMarkers,
} from "@arciin/shared"
import { DEFAULT_AI_SETTINGS, parseAiConfig } from "@arciin/config"

/**
 * Illustrations inside a Canvas draft.
 *
 * Every picture is a paid generation, so the default and the ceiling matter as
 * much as the rendering: a document padded with decoration is worse than a
 * plain one, and more expensive.
 */

describe("the setting", () => {
  it("is off unless the instance turns it on", () => {
    expect(DEFAULT_AI_SETTINGS.canvasImages).toBe(false)
    expect(parseAiConfig({}).canvasImages).toBe(false)
  })

  it("is read from the stored config", () => {
    expect(parseAiConfig({ canvasImages: true }).canvasImages).toBe(true)
  })

  it("does not disturb the other settings", () => {
    const parsed = parseAiConfig({ canvasImages: true })
    expect(parsed.agent).toBe(DEFAULT_AI_SETTINGS.agent)
    expect(parsed.emojiUsage).toBe(DEFAULT_AI_SETTINGS.emojiUsage)
  })
})

describe("finding illustration markers", () => {
  const DRAFT = [
    "# Photosynthesis",
    "",
    "Light strikes the thylakoid membrane and excites electrons.",
    "",
    "[image: a chloroplast with stacked thylakoid discs lit from above]",
    "",
    "The Calvin Cycle then fixes carbon in the stroma.",
    "",
    "[image: carbon dioxide entering a spiral of sugar molecules]",
  ].join("\n")

  it("finds each marker with its description", () => {
    const found = findCanvasImageMarkers(DRAFT)
    expect(found).toHaveLength(2)
    expect(found[0]!.description).toBe("a chloroplast with stacked thylakoid discs lit from above")
  })

  it("ignores a draft with no markers", () => {
    expect(findCanvasImageMarkers("# Title\n\nJust prose.")).toEqual([])
  })

  it("ignores an empty or too-short description", () => {
    expect(findCanvasImageMarkers("[image: ]")).toEqual([])
    expect(findCanvasImageMarkers("[image: ab]")).toEqual([])
  })

  it("does not swallow ordinary bracketed text", () => {
    expect(findCanvasImageMarkers("See [1] and [note: keep this].")).toEqual([])
  })

  it("strips markers for a plain-text copy", () => {
    expect(stripCanvasImageMarkers(DRAFT)).not.toContain("[image:")
    expect(stripCanvasImageMarkers(DRAFT)).toContain("Calvin Cycle")
  })
})

describe("what the assistant is told", () => {
  const block = buildCanvasImageInstruction()

  it("caps how many a document may carry", () => {
    expect(block).toContain("At most 3")
    expect(block).toContain("none at all is a perfectly good answer")
  })

  it("asks for pictures that carry meaning, not decoration", () => {
    expect(block).toContain("Never illustrate for decoration")
  })

  it("keeps lettering out of the picture", () => {
    expect(block).toContain("no words, labels or captions inside the picture")
  })

  it("puts the marker on its own line, after the paragraph", () => {
    expect(block).toContain("on its own line")
    expect(block).toContain("never mid-sentence")
  })
})
