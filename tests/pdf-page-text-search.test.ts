import { describe, expect, it } from "vitest"

import {
  buildSearchableText,
  findMatchRange,
  type PdfTextItem,
} from "@/lib/files/pdf-page-text-search"

/**
 * The matcher that turns a phrase into a position on the page.
 *
 * A highlight only appears if this finds the text, so the fallback recovering
 * the right phrase proves nothing on its own. These drive the real matcher —
 * not a copy of it — against the text layout a real PDF produces: words split
 * across text items, decimals broken apart, and body text wrapped mid-phrase.
 */

/** pdf.js hands over one item per run of text; only `str` matters for matching. */
function items(strings: string[]): PdfTextItem[] {
  return strings.map((str) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: str.length * 5 }))
}

function findable(pageItems: string[], query: string, mode: "default" | "heading" = "default"): boolean {
  const { text } = buildSearchableText(items(pageItems))
  return findMatchRange(text, query, mode) !== null
}

/** What the viewer would actually highlight, so a wrong match is visible. */
function matched(pageItems: string[], query: string, mode: "default" | "heading" = "default"): string | null {
  const { text } = buildSearchableText(items(pageItems))
  const range = findMatchRange(text, query, mode)
  return range ? text.slice(range.start, range.end) : null
}

// The Calvin Cycle page from the screenshot, as pdf.js hands it over: a heading
// as its own item, then the body broken at arbitrary points.
const CALVIN_PAGE = [
  "Stage 2: The Calvin Cycle (Light-Independent Reactions)",
  "Location:",
  "Stroma (the fluid surrounding the thylakoids)",
  "Carbon",
  "Fixation",
  "The enzyme RuBisCO grabs CO",
  "2",
  " from the atmosphere and attaches it to a five-carbon sugar",
  "called RuBP (ribulose bisphosphate).",
  "Reduction",
  "ATP and NADPH from the light-dependent reactions donate energy and electrons",
  "Regeneration of RuBP",
]

describe("finding a heading split across text items", () => {
  it("finds Carbon Fixation even though it arrives as two items", () => {
    // This is the exact phrase from the report, and the exact reason a naive
    // substring search fails: the words are separate items in the text layer.
    expect(findable(CALVIN_PAGE, "Carbon Fixation")).toBe(true)
  })

  it("finds it regardless of case", () => {
    expect(findable(CALVIN_PAGE, "carbon fixation")).toBe(true)
  })

  it("finds a heading that contains punctuation", () => {
    expect(findable(CALVIN_PAGE, "Stage 2: The Calvin Cycle")).toBe(true)
  })

  it("finds the other two Calvin Cycle headings", () => {
    expect(findable(CALVIN_PAGE, "Reduction")).toBe(true)
    expect(findable(CALVIN_PAGE, "Regeneration of RuBP")).toBe(true)
  })

  it("finds a phrase from the body text", () => {
    expect(findable(CALVIN_PAGE, "ribulose bisphosphate")).toBe(true)
  })

  it("finds a phrase that spans an item break", () => {
    expect(findable(CALVIN_PAGE, "atmosphere and attaches it")).toBe(true)
  })

  it("does not find text that is not on the page", () => {
    expect(findable(CALVIN_PAGE, "Photolysis of Water")).toBe(false)
    expect(findable(CALVIN_PAGE, "mitochondrial matrix")).toBe(false)
  })
})

describe("numbered section titles", () => {
  // The pattern rule that lets "3.2" match "3 . 2" across a text-item break.
  const NUMBERED = ["3.2", "The Radiation", "Laws"]

  it("finds a numbered heading written the same way", () => {
    expect(findable(NUMBERED, "3.2 The Radiation Laws")).toBe(true)
  })

  it("finds it when the extractor spaced the decimal", () => {
    expect(findable(["3 . 2 The Radiation Laws"], "3.2 The Radiation Laws")).toBe(true)
  })

  it("highlights the heading itself, not the whole line", () => {
    expect(matched(NUMBERED, "3.2 The Radiation Laws", "heading")).toBe("3.2 The Radiation Laws")
  })
})

describe("whitespace and line wrapping", () => {
  const WRAPPED = ["Photosynthesis is the biochemical pathway by which green", "plants, algae"]

  it("matches across a line break", () => {
    expect(findable(WRAPPED, "green plants")).toBe(true)
  })

  it("tolerates extra spaces in the query", () => {
    expect(findable(WRAPPED, "  biochemical   pathway  ")).toBe(true)
  })
})

describe("phrases the fallback produces are findable", () => {
  // Closes the loop: what infer-pdf-highlight extracts must be what the matcher
  // can locate. A fallback that recovers an unsearchable phrase highlights
  // nothing, which is the bug it exists to fix.
  it.each([
    ["carbon Fixation", CALVIN_PAGE],
    ["Reduction", CALVIN_PAGE],
    ["Regeneration of RuBP", CALVIN_PAGE],
  ])("%j is locatable on its page", (phrase, page) => {
    expect(findable(page, phrase, "heading")).toBe(true)
  })

  it("heading mode lands on the heading, not the sentence mentioning it", () => {
    // "Carbon Fixation" appears as a heading and the words recur in the body;
    // the highlight has to land on the title the user pointed at.
    const hit = matched(CALVIN_PAGE, "Carbon Fixation", "heading")
    expect(hit?.toLowerCase()).toBe("carbon fixation")
  })
})

describe("the matcher terminates", () => {
  // The flexible pattern is driven with exec() in a loop. Built without the
  // global flag it returned the same match forever and grew the results array
  // until the process died — a frozen tab, not a missing highlight. It stayed
  // hidden only because no highlight ever reached this code.
  it("returns instead of looping on a repeated phrase", () => {
    const page = Array.from({ length: 200 }, () => "Carbon Fixation appears again here")
    const start = Date.now()
    expect(findable(page, "Carbon Fixation")).toBe(true)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it("handles a query that matches at every position", () => {
    const start = Date.now()
    expect(findable(["a a a a a a a a a a a a a a a a"], "a")).toBe(true)
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
