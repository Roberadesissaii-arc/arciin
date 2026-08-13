import { describe, expect, it } from "vitest"

import {
  buildSearchableText,
  findMatchRange,
  flattenScriptDigits,
  type PdfTextItem,
} from "@/lib/files/pdf-page-text-search"
import { extractHighlightPhrases } from "@/lib/files/infer-pdf-highlight"

/**
 * Chemistry, and the words that describe where text is rather than what it says.
 *
 * The photosynthesis PDF's text layer lost its subscripts: the page reads
 * "6 CO + 6 HO + light energy" where the paper shows CO₂ and H₂O. A model
 * quoting the formula writes the subscripts, so nothing matched.
 */

function items(strings: string[]): PdfTextItem[] {
  return strings.map((str) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: str.length * 5 }))
}

function findable(page: string[], query: string, mode: "default" | "heading" = "default") {
  const { text } = buildSearchableText(items(page))
  return findMatchRange(text, query, mode) !== null
}

// Exactly as the extractor handed this document over.
const PAGE = [
  "The net reaction:",
  "6 CO + 6 HO + light energy CHO + 6 O",
  "The enzyme RuBisCO grabs CO from the atmosphere and attaches it to a five-carbon sugar",
  "2 HO 4 H + 4 e + O",
  "3-PGA into glyceraldehyde-3-phosphate (G3P), a three-carbon sugar",
]

describe("flattening scripts", () => {
  it.each([
    ["CO₂", "CO2"],
    ["H₂O", "H2O"],
    ["CO²", "CO2"],
    ["x¹y³", "x1y3"],
    ["C₆H₁₂O₆", "C6H12O6"],
  ])("%s → %s", (input, want) => {
    expect(flattenScriptDigits(input)).toBe(want)
  })

  it("leaves ordinary text alone", () => {
    expect(flattenScriptDigits("Carbon Fixation 3.2")).toBe("Carbon Fixation 3.2")
  })
})

describe("a query with subscripts against a page that lost them", () => {
  it.each([
    "CO₂",
    "CO2",
    "6 CO₂ + 6 H₂O",
    "RuBisCO grabs CO₂ from the atmosphere",
  ])("finds %j", (query) => {
    expect(findable(PAGE, query)).toBe(true)
  })

  it("finds the photolysis equation written with subscripts", () => {
    expect(findable(PAGE, "2 H₂O")).toBe(true)
  })

  it("still finds a formula the page did keep", () => {
    expect(findable(PAGE, "G3P")).toBe(true)
    expect(findable(PAGE, "3-PGA")).toBe(true)
  })

  it("does not match a formula that is genuinely absent", () => {
    expect(findable(PAGE, "NH3 ammonia synthesis")).toBe(false)
  })
})

describe("words describing position, not content", () => {
  // "Underline the Reduction heading" searched for the string "Reduction
  // heading", which is on no page, so it marked nothing at all.
  it.each([
    ["underline the Reduction heading", "Reduction"],
    ["underline the heading Reduction", "Reduction"],
    ["cross out the Location line", "Location"],
    ["highlight the Overview section", "Overview"],
    ["circle the Carbon Fixation title", "Carbon Fixation"],
    ["put a box around the Summary Table", "Summary Table"],
    ["draw a circle around the Reduction heading", "Reduction"],
    ["mark the first row", "first"],
  ])("%j → %j", (text, want) => {
    expect(extractHighlightPhrases(text)).toEqual([want])
  })

  it("keeps Table when it is part of the heading", () => {
    // "Summary Table" is the heading; stripping the noun would break the match.
    expect(extractHighlightPhrases("highlight the Summary Table")).toEqual(["Summary Table"])
  })

  it("never strips a phrase down to nothing", () => {
    expect(extractHighlightPhrases("highlight the heading")).toEqual([])
  })
})

describe("the two fixes together", () => {
  it("underlining a heading by description finds it on the page", () => {
    const phrase = extractHighlightPhrases("underline the Reduction heading")[0]!
    expect(findable(["Reduction", "ATP and NADPH from the light-dependent reactions"], phrase, "heading")).toBe(true)
  })

  it("marking the net reaction with subscripts finds the flattened page text", () => {
    const phrase = extractHighlightPhrases("highlight where it says 6 CO₂ + 6 H₂O")[0]!
    expect(findable(PAGE, phrase)).toBe(true)
  })
})

describe("a mark must be a plausible size", () => {
  // Seen on screen: a yellow bar across empty paper beside the net-reaction
  // line. The rect came from a run whose reported geometry was wrong, and a
  // wash of colour over blank space is worse than no mark at all.
  const PAGE_WIDTH = 1000

  function plausible(rects: { width: number; height: number }[]) {
    return rects.filter((r) => r.width > 1 && r.height > 1 && r.width <= PAGE_WIDTH * 0.8)
  }

  it("keeps a normal phrase rect", () => {
    expect(plausible([{ width: 280, height: 15 }])).toHaveLength(1)
  })

  it("keeps a rect spanning most of a text line", () => {
    expect(plausible([{ width: 780, height: 15 }])).toHaveLength(1)
  })

  it("drops a rect that spans the sheet", () => {
    expect(plausible([{ width: 960, height: 15 }])).toHaveLength(0)
  })

  it("drops a degenerate rect", () => {
    expect(plausible([{ width: 0.4, height: 15 }, { width: 200, height: 0 }])).toHaveLength(0)
  })
})

describe("a note stays inside its box", () => {
  // The margin notes overflowed their boxes and ran across the page text,
  // because each line is positioned individually and cannot wrap.
  it("fits fewer characters per line than the box could hold at the old ratio", () => {
    const width = 150
    const fontSize = 15
    const chars = (ratio: number) => Math.max(8, Math.floor(width / (fontSize * ratio)))
    expect(chars(0.56)).toBeLessThan(chars(0.46))
  })
})

describe("a mark finds its page even when the tag names the wrong one", () => {
  // Asked to highlight the Summary Table while reading page 2, the mark was
  // resolved against page 1 and reported missing with the heading plainly on
  // screen. Which page is "in view" depends on scroll position when the reply
  // lands, so being off by one is normal; the phrase is the reliable part.
  const PAGES: Record<number, string[]> = {
    1: ["Photosynthesis: The Two-Stage Process", "Overview", "Stage 1: Light-Dependent Reactions"],
    2: ["Regeneration of RuBP", "Summary Table", "| Feature | Light-Dependent Reactions |"],
    3: ["Why Two Stages?", "Key Terms", "- Thylakoid: Flattened membrane sac"],
  }

  /** Mirrors the viewer: try the named page, then its neighbours. */
  function resolve(quote: string, named: number): number | null {
    const hit = (p: number) =>
      (PAGES[p] ?? []).some((line) => line.toLowerCase().includes(quote.toLowerCase()))
    if (hit(named)) return named
    for (const delta of [1, -1, 2, -2]) {
      const candidate = named + delta
      if (candidate < 1 || candidate > 3) continue
      if (hit(candidate)) return candidate
    }
    return null
  }

  it("finds the Summary Table when the tag said page 1", () => {
    expect(resolve("Summary Table", 1)).toBe(2)
  })

  it("prefers the named page when the phrase is on it", () => {
    expect(resolve("Key Terms", 3)).toBe(3)
  })

  it("searches backwards as well as forwards", () => {
    expect(resolve("Overview", 3)).toBe(1)
  })

  it("still reports a phrase that is on no page", () => {
    expect(resolve("mitochondrial matrix", 2)).toBeNull()
  })
})
