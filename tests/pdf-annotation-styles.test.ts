import { describe, expect, it } from "vitest"

import { parseAssistantHighlights, stripHighlightTags } from "@/lib/files/parse-pdf-highlight-request"
import { inferPdfHighlightTargets } from "@/lib/files/infer-pdf-highlight"
import {
  ANNOTATION_VERB,
  DEFAULT_ANNOTATION_STYLE,
  PDF_ANNOTATION_STYLES,
  normalizeAnnotationStyle,
  styleFromRequest,
} from "@/lib/files/pdf-annotation-style"

/**
 * The pen, not just the highlighter.
 *
 * Highlighting worked, so the ask became the rest of the toolkit: underline,
 * circle, box, strike — with the assistant picking the one the request named.
 */

const PAGE_INDEX = [{ pdfPage: 16, printedPage: 12 }]

describe("the request picks the mark", () => {
  it.each([
    ["highlight the summary table", "highlight"],
    ["underline the net reaction", "underline"],
    ["circle the Calvin Cycle heading", "circle"],
    ["draw a circle around Carbon Fixation", "circle"],
    ["box the summary table", "box"],
    ["outline the Reduction heading", "box"],
    ["put a frame around Regeneration of RuBP", "box"],
    ["cross out the second paragraph", "strike"],
    ["strike through that sentence", "strike"],
    ["mark where it says photolysis", "highlight"],
  ])("%j → %s", (text, style) => {
    expect(styleFromRequest(text)).toBe(style)
  })

  it("names no mark when the user names no verb", () => {
    expect(styleFromRequest("where is the summary table")).toBeNull()
  })

  it("falls back to highlighting when nothing was named", () => {
    const targets = inferPdfHighlightTargets({
      userText: "show me where it says RuBisCO",
      assistantText: "Done.",
      currentPage: 2,
      maxPage: 3,
    })
    expect(targets[0]!.style).toBe(DEFAULT_ANNOTATION_STYLE)
  })

  it.each([
    ["circle the Summary Table", "circle"],
    ["underline the Summary Table", "underline"],
    ["box the Summary Table", "box"],
    ["cross out the Summary Table", "strike"],
  ])("%j carries the mark through inference", (text, style) => {
    const targets = inferPdfHighlightTargets({
      userText: text,
      assistantText: "Done.",
      currentPage: 2,
      maxPage: 3,
    })
    expect(targets).toHaveLength(1)
    expect(targets[0]!.style).toBe(style)
  })

  it("applies one mark to every target in a multi-target request", () => {
    const targets = inferPdfHighlightTargets({
      userText: "circle Carbon Fixation and the Summary Table",
      assistantText: "Done.",
      currentPage: 2,
      maxPage: 3,
    })
    expect(targets.length).toBeGreaterThanOrEqual(2)
    expect(targets.every((t) => t.style === "circle")).toBe(true)
  })
})

describe("tags carry the mark", () => {
  it.each(PDF_ANNOTATION_STYLES)("[%s-heading:…] on the page in view", (style) => {
    const out = parseAssistantHighlights(`[${style}-heading:"Carbon Fixation"]`, {
      currentPdfPage: 2,
      maxPage: 3,
    })
    expect(out).toEqual([{ page: 2, quote: "Carbon Fixation", kind: "heading", style }])
  })

  it.each(PDF_ANNOTATION_STYLES)("[%s-current:…] on the page in view", (style) => {
    const out = parseAssistantHighlights(`[${style}-current:"RuBisCO"]`, {
      currentPdfPage: 2,
      maxPage: 3,
    })
    expect(out[0]).toMatchObject({ page: 2, style, kind: "default" })
  })

  it.each(PDF_ANNOTATION_STYLES)("[%s:PAGE:…] on an explicit page", (style) => {
    const out = parseAssistantHighlights(`[${style}:3:"Summary Table"]`, { maxPage: 3 })
    expect(out[0]).toMatchObject({ page: 3, style })
  })

  it.each(PDF_ANNOTATION_STYLES)("[%s-printed:PAGE:…] through the page index", (style) => {
    const out = parseAssistantHighlights(`[${style}-printed:12:"Reduction"]`, {
      maxPage: 40,
      pageIndex: PAGE_INDEX,
    })
    expect(out[0]).toMatchObject({ page: 16, style })
  })

  it("accepts the aliases a model reaches for", () => {
    expect(parseAssistantHighlights('[pen-heading:"X"]', { currentPdfPage: 1 })[0]!.style).toBe("circle")
    expect(parseAssistantHighlights('[outline-heading:"X"]', { currentPdfPage: 1 })[0]!.style).toBe("box")
    expect(parseAssistantHighlights('[mark-heading:"X"]', { currentPdfPage: 1 })[0]!.style).toBe("highlight")
    expect(parseAssistantHighlights('[strikethrough-heading:"X"]', { currentPdfPage: 1 })[0]!.style).toBe("strike")
  })

  it("mixes marks in one answer", () => {
    const out = parseAssistantHighlights(
      '[circle-heading:"Carbon Fixation"] [underline-heading:"Reduction"]',
      { currentPdfPage: 2, maxPage: 3 },
    )
    expect(out.map((h) => [h.quote, h.style])).toEqual([
      ["Carbon Fixation", "circle"],
      ["Reduction", "underline"],
    ])
  })

  it("keeps two different marks on the same text", () => {
    // Asked to highlight and circle one heading, the user wants both marks.
    const out = parseAssistantHighlights(
      '[highlight-heading:"Summary Table"] [circle-heading:"Summary Table"]',
      { currentPdfPage: 2 },
    )
    expect(out).toHaveLength(2)
  })

  it("still collapses the same mark twice", () => {
    const out = parseAssistantHighlights(
      '[circle-heading:"Summary Table"] [circle-heading:"summary table"]',
      { currentPdfPage: 2 },
    )
    expect(out).toHaveLength(1)
  })

  it("strips every mark tag from what the user reads", () => {
    const raw =
      'Done. [circle-heading:"Carbon Fixation"] [underline:2:"RuBisCO"] [strike-printed:12:"old"] Both marked.'
    const shown = stripHighlightTags(raw).replace(/\s+/g, " ").trim()
    expect(shown).toBe("Done. Both marked.")
    for (const style of PDF_ANNOTATION_STYLES) expect(shown).not.toContain(style)
  })
})

describe("style names", () => {
  it("normalises anything unrecognised to the default", () => {
    expect(normalizeAnnotationStyle("sparkles")).toBe(DEFAULT_ANNOTATION_STYLE)
    expect(normalizeAnnotationStyle(null)).toBe(DEFAULT_ANNOTATION_STYLE)
    expect(normalizeAnnotationStyle("")).toBe(DEFAULT_ANNOTATION_STYLE)
  })

  it("round-trips every style through its own name", () => {
    for (const style of PDF_ANNOTATION_STYLES) {
      expect(normalizeAnnotationStyle(style)).toBe(style)
    }
  })

  it("reads back in a sentence", () => {
    for (const style of PDF_ANNOTATION_STYLES) {
      expect(ANNOTATION_VERB[style]).toMatch(/\w/)
    }
  })
})

describe("backwards compatibility", () => {
  it("an untagged style still means highlight", () => {
    const out = parseAssistantHighlights('[highlight-heading:"Carbon Fixation"]', {
      currentPdfPage: 2,
    })
    expect(out[0]!.style).toBe("highlight")
  })

  it("the old numeric options form still parses", () => {
    expect(parseAssistantHighlights('[highlight:2:"X"]', 3)[0]).toMatchObject({ page: 2 })
  })
})
