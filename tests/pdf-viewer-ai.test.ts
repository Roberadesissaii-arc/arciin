import { describe, expect, it } from "vitest"

import { parseAssistantHighlights, stripHighlightTags } from "@/lib/files/parse-pdf-highlight-request"
import { resolvePdfGotoPage } from "@/lib/files/parse-pdf-page-request"
import {
  extractHighlightPhrase,
  extractHighlightPhrases,
  extractPhrasesFromAnswer,
  extractQuotedPhraseFromAnswer,
  inferPdfHighlightTargets,
  looksLikeHeading,
  wantsPdfHighlight,
} from "@/lib/files/infer-pdf-highlight"
import { inferPdfGotoPage, wantsPageNavigation } from "@/lib/files/infer-pdf-page-request"

/**
 * The Ask-AI tab inside the document preview.
 *
 * Reported: asked to highlight where the page says "Carbon Fixation", the panel
 * answered `Highlighted "Carbon Fixation" — the first phase of the Calvin
 * Cycle…` and marked nothing. The tag pipeline was fine; the model never emitted
 * a tag, and there was no floor under that.
 */

const PAGE_INDEX = [
  // A book with four pages of front matter: printed 1 is the fifth file page.
  { pdfPage: 5, printedPage: 1 },
  { pdfPage: 6, printedPage: 2 },
  { pdfPage: 7, printedPage: 3 },
  { pdfPage: 16, printedPage: 12 },
]

// ── Tags: the fast path ───────────────────────────────────────────────────────

describe("highlight tags", () => {
  it("reads a heading tag onto the page in view", () => {
    const out = parseAssistantHighlights('Here it is. [highlight-heading:"Carbon Fixation"]', {
      currentPdfPage: 2,
      maxPage: 3,
    })
    expect(out).toEqual([{ page: 2, quote: "Carbon Fixation", kind: "heading" }])
  })

  it("reads a plain current-page tag", () => {
    const out = parseAssistantHighlights('[highlight-current:"RuBisCO grabs CO"]', {
      currentPdfPage: 2,
      maxPage: 3,
    })
    expect(out[0]).toMatchObject({ page: 2, kind: "default" })
  })

  it("reads an explicit file page", () => {
    const out = parseAssistantHighlights('[highlight:3:"Summary Table"]', { maxPage: 3 })
    expect(out).toEqual([{ page: 3, quote: "Summary Table", kind: "default" }])
  })

  it("maps a printed page through the page index", () => {
    const out = parseAssistantHighlights('[highlight-printed:12:"Reduction"]', {
      maxPage: 40,
      pageIndex: PAGE_INDEX,
    })
    expect(out).toEqual([{ page: 16, quote: "Reduction", kind: "default" }])
  })

  it("clamps a page past the end of the file", () => {
    const out = parseAssistantHighlights('[highlight:900:"Overview"]', { maxPage: 3 })
    expect(out[0]!.page).toBe(3)
  })

  it("collects several tags in one answer", () => {
    const out = parseAssistantHighlights(
      '[highlight-heading:"Carbon Fixation"] and [highlight-heading:"Reduction"]',
      { currentPdfPage: 2, maxPage: 3 },
    )
    expect(out.map((h) => h.quote)).toEqual(["Carbon Fixation", "Reduction"])
  })

  it("does not repeat the same target twice", () => {
    const out = parseAssistantHighlights(
      '[highlight-heading:"Carbon Fixation"] [highlight-heading:"carbon fixation"]',
      { currentPdfPage: 2 },
    )
    expect(out).toHaveLength(1)
  })

  it("ignores a current-page tag when no page is in view", () => {
    expect(parseAssistantHighlights('[highlight-current:"x"]', {})).toEqual([])
  })

  it("accepts single quotes and bare text", () => {
    expect(parseAssistantHighlights("[highlight:1:'Overview']", {})[0]!.quote).toBe("Overview")
    expect(parseAssistantHighlights("[highlight:1:Overview]", {})[0]!.quote).toBe("Overview")
  })

  it("strips every tag from what the user reads", () => {
    const raw =
      'Found it. [highlight-heading:"Carbon Fixation"] [goto-page:2] It is the first phase.'
    const shown = stripHighlightTags(raw).replace(/\[goto-page:\d+\]/g, "").replace(/\s+/g, " ").trim()
    expect(shown).toBe("Found it. It is the first phase.")
    expect(shown).not.toContain("highlight")
  })
})

// ── Navigation tags ───────────────────────────────────────────────────────────

describe("navigation tags", () => {
  it("scrolls to a file page", () => {
    expect(resolvePdfGotoPage("[goto-page:7]", { maxPage: 40 })).toBe(7)
  })

  it("maps a printed page to its file page", () => {
    expect(resolvePdfGotoPage("[goto-printed:12]", { maxPage: 40, pageIndex: PAGE_INDEX })).toBe(16)
  })

  it("clamps past the end", () => {
    expect(resolvePdfGotoPage("[goto-page:999]", { maxPage: 40 })).toBe(40)
  })

  it("takes the last tag when the model changes its mind", () => {
    expect(resolvePdfGotoPage("[goto-page:2] actually [goto-page:9]", { maxPage: 40 })).toBe(9)
  })

  it("returns null when there is no tag", () => {
    expect(resolvePdfGotoPage("It is on page 12.", { maxPage: 40 })).toBeNull()
  })
})

// ── Intent detection ──────────────────────────────────────────────────────────

describe("recognising a highlight request", () => {
  it.each([
    "Can you highlight, you know what it says carbon. Fixation.",
    "highlight the Calvin Cycle",
    "underline where it says photolysis",
    "mark the summary table",
    "point to the section on ATP",
    "show me where it says RuBisCO",
    "find the part about thylakoid membrane",
    "circle the net reaction",
    "locate the regeneration of RuBP",
    'highlight "Light-Dependent Reactions"',
  ])("%s", (text) => {
    expect(wantsPdfHighlight(text)).toBe(true)
  })

  it.each([
    "What is carbon fixation?",
    "Explain the Calvin Cycle",
    "Summarize this page",
    "How many pages is this?",
    "Who wrote this document?",
  ])("does not fire on %j", (text) => {
    expect(wantsPdfHighlight(text)).toBe(false)
  })
})

describe("pulling the phrase out of the request", () => {
  it("handles the dictated sentence that started this", () => {
    // Speech-to-text split the term across a full stop and added filler.
    expect(extractHighlightPhrase("Can you highlight, you know what it says carbon. Fixation.")).toBe(
      "carbon Fixation",
    )
  })

  it("prefers what the user quoted", () => {
    expect(extractHighlightPhrase('highlight "Light-Dependent Reactions" please')).toBe(
      "Light-Dependent Reactions",
    )
  })

  it.each([
    ["highlight the Calvin Cycle", "Calvin Cycle"],
    ["underline where it says photolysis", "photolysis"],
    ["show me where it says RuBisCO", "RuBisCO"],
    ["mark the summary table", "summary table"],
    ["point to ATP and NADPH Production", "ATP and NADPH Production"],
    ["find Regeneration of RuBP", "Regeneration of RuBP"],
  ])("%s → %s", (text, want) => {
    expect(extractHighlightPhrase(text)).toBe(want)
  })

  it("returns nothing when the user did not ask for a highlight", () => {
    expect(extractHighlightPhrase("What does carbon fixation mean?")).toBeNull()
  })

  it("drops a trailing courtesy", () => {
    expect(extractHighlightPhrase("highlight the Overview please")).toBe("Overview")
  })
})

describe("falling back to what the model quoted", () => {
  it("takes the phrase out of the answer that started this", () => {
    const answer =
      'Highlighted "Carbon Fixation" — the first phase of the Calvin Cycle, where RuBisCO grabs CO₂.'
    expect(extractQuotedPhraseFromAnswer(answer)).toBe("Carbon Fixation")
  })

  it("ignores an answer with no quoted span", () => {
    expect(extractQuotedPhraseFromAnswer("I could not find that on this page.")).toBeNull()
  })
})

describe("heading vs body text", () => {
  it.each(["Carbon Fixation", "Overview", "ATP and NADPH Production"])("%s is a heading", (p) => {
    expect(looksLikeHeading(p)).toBe(true)
  })

  it.each([
    "The enzyme RuBisCO grabs CO2 from the atmosphere and attaches it to a five-carbon sugar.",
    "It takes place inside chloroplasts, organelles packed with chlorophyll.",
  ])("%j is body text", (p) => {
    expect(looksLikeHeading(p)).toBe(false)
  })
})

// ── The whole fallback ────────────────────────────────────────────────────────

describe("highlighting when the model emitted no tag", () => {
  it("recovers the reported failure end to end", () => {
    const targets = inferPdfHighlightTargets({
      userText: "Can you highlight, you know what it says carbon. Fixation.",
      assistantText:
        'Highlighted "Carbon Fixation" — the first phase of the Calvin Cycle, where RuBisCO grabs CO₂.',
      currentPage: 2,
      maxPage: 3,
    })
    expect(targets).toHaveLength(1)
    expect(targets[0]!.page).toBe(2)
    expect(targets[0]!.kind).toBe("heading")
    expect(targets[0]!.quote.toLowerCase()).toContain("carbon")
    expect(targets[0]!.quote.toLowerCase()).toContain("fixation")
  })

  it("uses the model's quote when the request named nothing searchable", () => {
    const targets = inferPdfHighlightTargets({
      userText: "highlight it",
      assistantText: 'Highlighted "Photolysis of Water" for you.',
      currentPage: 1,
      maxPage: 3,
    })
    expect(targets[0]!.quote).toBe("Photolysis of Water")
  })

  it("marks the page the user is actually looking at", () => {
    const targets = inferPdfHighlightTargets({
      userText: "highlight the Summary Table",
      assistantText: "Done.",
      currentPage: 3,
      maxPage: 3,
    })
    expect(targets[0]!.page).toBe(3)
  })

  it("stays out of the way when the user only asked a question", () => {
    expect(
      inferPdfHighlightTargets({
        userText: "What is carbon fixation?",
        assistantText: 'Carbon fixation is the first phase of the "Calvin Cycle".',
        currentPage: 2,
        maxPage: 3,
      }),
    ).toEqual([])
  })

  it("does nothing without a page in view", () => {
    expect(
      inferPdfHighlightTargets({
        userText: "highlight the Overview",
        assistantText: "Done.",
        currentPage: 0,
      }),
    ).toEqual([])
  })

  it("does nothing when the page is past the end of the file", () => {
    expect(
      inferPdfHighlightTargets({
        userText: "highlight the Overview",
        assistantText: "Done.",
        currentPage: 99,
        maxPage: 3,
      }),
    ).toEqual([])
  })

  it("refuses a phrase too short to search for", () => {
    expect(
      inferPdfHighlightTargets({
        userText: "highlight it",
        assistantText: "Done.",
        currentPage: 1,
        maxPage: 3,
      }),
    ).toEqual([])
  })
})

// ── Navigation fallback ───────────────────────────────────────────────────────

describe("navigating when the model emitted no tag", () => {
  it.each([
    "go to page 12",
    "take me to page 3",
    "open page 7",
    "jump to p. 9",
    "turn to pg 4",
  ])("recognises %j", (text) => {
    expect(wantsPageNavigation(text)).toBe(true)
  })

  it.each(["What is on this page?", "Summarize page 3 for me", "How many pages?"])(
    "does not fire on %j",
    (text) => {
      expect(wantsPageNavigation(text)).toBe(false)
    },
  )

  it("uses the number the user asked for", () => {
    expect(
      inferPdfGotoPage({ userText: "go to page 7", assistantText: "That's page 3.", maxPage: 40 }),
    ).toBe(7)
  })

  it("treats the user's number as the printed page when the file has an index", () => {
    // Printed 12 is file page 16 on a book with front matter.
    expect(
      inferPdfGotoPage({
        userText: "go to page 12",
        assistantText: "",
        maxPage: 40,
        pageIndex: PAGE_INDEX,
      }),
    ).toBe(16)
  })

  it("falls back to the page the answer names", () => {
    expect(
      inferPdfGotoPage({
        userText: "take me to where the Calvin Cycle starts",
        assistantText: "The Calvin Cycle begins on page 2.",
        maxPage: 40,
      }),
    ).toBe(2)
  })

  it("refuses a page past the end of the file", () => {
    expect(inferPdfGotoPage({ userText: "go to page 900", assistantText: "", maxPage: 3 })).toBeNull()
  })

  it("stays put when the user only asked a question", () => {
    expect(
      inferPdfGotoPage({
        userText: "What does page 3 cover?",
        assistantText: "Page 3 has the summary table.",
        maxPage: 40,
      }),
    ).toBeNull()
  })
})

// ── Precedence ────────────────────────────────────────────────────────────────

describe("tags outrank the fallback", () => {
  it("a tagged answer is used as-is and the fallback never runs", () => {
    const answer = 'Marked it. [highlight-heading:"Reduction"]'
    const tagged = parseAssistantHighlights(answer, { currentPdfPage: 2, maxPage: 3 })
    expect(tagged).toHaveLength(1)
    // The panel only infers when the tag parse produced nothing; if both ran the
    // user would get two highlights for one request.
    expect(tagged[0]!.quote).toBe("Reduction")
  })
})

// ── Several targets in one request ────────────────────────────────────────────

describe("highlighting more than one thing at once", () => {
  const TWO_TARGETS =
    "OK now I want you to highlight two things for me. You know what it says. " +
    "Caravan fixation and then the other one that I want you to highlight is summary table."

  const TWO_ANSWER = [
    "Done — I've highlighted both:",
    "",
    "* Carbon Fixation — the heading where RuBisCO fixes CO₂ onto RuBP.",
    "* Summary Table — the comparison table of Light-Dependent Reactions vs. Calvin Cycle.",
    "",
    "Both are on PDF page 2.",
  ].join("\n")

  it("splits the request into both targets", () => {
    const phrases = extractHighlightPhrases(TWO_TARGETS)
    expect(phrases.length).toBeGreaterThanOrEqual(2)
    expect(phrases.join(" | ").toLowerCase()).toContain("summary table")
  })

  it("reads both targets out of the model's bullet list", () => {
    expect(extractPhrasesFromAnswer(TWO_ANSWER)).toEqual(["Carbon Fixation", "Summary Table"])
  })

  it("recovers the misheard word from the answer", () => {
    // Dictation produced "Caravan fixation", which is not on the page. The
    // model's list spells it correctly, and both spellings are offered so the
    // page search can pick the one it finds.
    const targets = inferPdfHighlightTargets({
      userText: TWO_TARGETS,
      assistantText: TWO_ANSWER,
      currentPage: 2,
      maxPage: 3,
    })
    const quotes = targets.map((t) => t.quote.toLowerCase())
    expect(quotes).toContain("carbon fixation")
    expect(quotes.some((q) => q.includes("summary table"))).toBe(true)
  })

  it("marks every target on the page in view", () => {
    const targets = inferPdfHighlightTargets({
      userText: TWO_TARGETS,
      assistantText: TWO_ANSWER,
      currentPage: 2,
      maxPage: 3,
    })
    expect(targets.length).toBeGreaterThanOrEqual(2)
    expect(targets.every((t) => t.page === 2)).toBe(true)
  })

  it.each([
    ['highlight "Carbon Fixation" and "Summary Table"', 2],
    ["highlight the Overview, the Reduction and the Summary Table", 3],
    ["highlight Photolysis of Water and also ATP and NADPH Production", 2],
    ["mark Reduction; Regeneration of RuBP", 2],
  ])("%s finds %i targets", (text, count) => {
    expect(extractHighlightPhrases(text).length).toBe(count)
  })

  it("does not split a phrase that merely contains 'and'", () => {
    // "ATP and NADPH Production" is one heading, not two targets.
    expect(extractHighlightPhrases("highlight ATP and NADPH Production")).toEqual([
      "ATP and NADPH Production",
    ])
  })

  it("still handles a single target", () => {
    expect(extractHighlightPhrases("highlight the Calvin Cycle")).toEqual(["Calvin Cycle"])
  })

  it("caps how many things one request can mark", () => {
    const many = "highlight a one, b two, c three, d four, e five, f six, g seven, h eight"
    const targets = inferPdfHighlightTargets({
      userText: many,
      assistantText: "",
      currentPage: 1,
      maxPage: 3,
    })
    expect(targets.length).toBeLessThanOrEqual(6)
  })

  it("does not fire on an answer that merely lists things", () => {
    // The user asked a question; a bulleted answer must not paint the page.
    expect(
      inferPdfHighlightTargets({
        userText: "What are the three phases of the Calvin Cycle?",
        assistantText: "* Carbon Fixation — first\n* Reduction — second\n* Regeneration — third",
        currentPage: 2,
        maxPage: 3,
      }),
    ).toEqual([])
  })
})

describe("tags and inference together", () => {
  // The panel unions both sources. A model asked for two targets often tags one
  // and describes the other in prose; taking only the tags drops half the ask.
  function union(finalText: string, userText: string, page: number, maxPage: number) {
    const tagged = parseAssistantHighlights(finalText, {
      maxPage,
      currentPdfPage: page,
    })
    const inferred = inferPdfHighlightTargets({
      userText,
      assistantText: finalText,
      currentPage: page,
      maxPage,
    })
    const merged = [...tagged]
    for (const t of inferred) {
      const key = `${t.page}:${t.quote.trim().toLowerCase()}`
      if (!merged.some((m) => `${m.page}:${m.quote.trim().toLowerCase()}` === key)) merged.push(t)
    }
    return merged
  }

  it("recovers the second target when only one was tagged", () => {
    const answer =
      'Done. [highlight-heading:"Carbon Fixation"]\n\n* Summary Table — the comparison table.'
    const merged = union(answer, "highlight carbon fixation and the summary table", 2, 3)
    const quotes = merged.map((m) => m.quote.toLowerCase())
    expect(quotes).toContain("carbon fixation")
    expect(quotes.some((q) => q.includes("summary table"))).toBe(true)
  })

  it("does not double-highlight a target that was tagged", () => {
    const answer = 'Done. [highlight-heading:"Summary Table"]'
    const merged = union(answer, "highlight the summary table", 2, 3)
    expect(merged).toHaveLength(1)
  })

  it("leaves a fully tagged answer alone", () => {
    const answer =
      '[highlight-heading:"Carbon Fixation"] [highlight-heading:"Summary Table"]'
    const merged = union(answer, "highlight carbon fixation and the summary table", 2, 3)
    expect(merged).toHaveLength(2)
  })
})
