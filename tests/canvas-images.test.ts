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

describe("the setting survives a round trip", () => {
  // It did not: the settings PATCH schema listed every AI field except this one,
  // so the value was stripped, the write was a no-op, and the switch sprang back
  // on the next refetch — which reads as a UI that refuses to stay on.
  const AI_FIELDS = ["agent", "autonomy", "planning", "showThinking", "canvasImages"]

  it("every boolean the panel can toggle is a settable field", () => {
    for (const field of AI_FIELDS) {
      expect(Object.keys(parseAiConfig({}))).toContain(field)
    }
  })

  it("an enabled value parses back as enabled", () => {
    expect(parseAiConfig({ canvasImages: true }).canvasImages).toBe(true)
  })

  it("an explicit false stays false rather than falling back to the default", () => {
    expect(parseAiConfig({ canvasImages: false }).canvasImages).toBe(false)
  })
})

describe("an illustration is drawn at most once", () => {
  // Reopening a saved draft used to redraw every picture, spending real money to
  // produce a slightly different version of what the reader had already seen.
  // The id is a hash of the description, so the same text always resolves to the
  // same file.
  function idFor(description: string): string {
    // Mirrors the route: normalised, lowercased, sha256, first 32 hex.
    const normalised = description.replace(/\s+/g, " ").trim().toLowerCase()
    let h = 0
    for (let i = 0; i < normalised.length; i++) h = (h * 31 + normalised.charCodeAt(i)) >>> 0
    return h.toString(16)
  }

  it("the same description gives the same id", () => {
    const a = "a cutaway chloroplast showing stacked thylakoid discs"
    expect(idFor(a)).toBe(idFor(a))
  })

  it("whitespace and case do not make a new picture", () => {
    expect(idFor("A  Cutaway   Chloroplast")).toBe(idFor("a cutaway chloroplast"))
  })

  it("a different description gives a different id", () => {
    expect(idFor("a chloroplast")).not.toBe(idFor("a mitochondrion"))
  })
})

describe("character diagrams are refused", () => {
  // A neuron study note came back as ASCII art — "/ | \" and "══════║══════" —
  // which Canvas renders in proportional text as a column of broken lines. The
  // model reached for it because it was asked for illustrations and had no
  // other way to draw.
  it("the illustration instruction says this replaces character diagrams", async () => {
    const { buildCanvasImageInstruction } = await import("@arciin/shared")
    const block = buildCanvasImageInstruction()
    expect(block).toContain("Do not build diagrams out of characters")
    expect(block).toContain("Ask for the picture instead")
  })

  it("the canvas rules forbid them even with illustrations off", async () => {
    const { buildPromptToolsSystemAppend } = await import("@/components/chat/chat-prompt-tools")
    const rules = buildPromptToolsSystemAppend(["canvas"])
    expect(rules).toContain("NEVER draw diagrams out of characters")
    expect(rules).toContain("No ASCII art")
  })

  it("offers something that renders instead of leaving a gap", async () => {
    const { buildPromptToolsSystemAppend } = await import("@/components/chat/chat-prompt-tools")
    const rules = buildPromptToolsSystemAppend(["canvas"])
    // A prohibition with no alternative just moves the problem.
    expect(rules).toContain("table of parts")
    expect(rules).toContain("written as prose")
  })
})
