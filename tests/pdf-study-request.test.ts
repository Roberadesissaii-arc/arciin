import { describe, expect, it } from "vitest"

import {
  buildRegenerateNoteInstruction,
  buildStudyPassInstruction,
  isStudyAnnotationRequest,
  studyPassShape,
} from "@/lib/files/pdf-study-request"
import { buildAnnotatedPdf, annotatedFilename } from "@/lib/files/pdf-annotated-export"
import { extractHighlightPhrases } from "@/lib/files/infer-pdf-highlight"

/**
 * Why the study pass instruction exists at all.
 *
 * Measured against the running endpoint: "Explain this page to me", with the
 * tags fully documented in the 10.6 KB system prompt, returned 1,999 characters
 * of prose and zero tags. The identical requirement restated on the user's turn
 * returned three marks and four notes. These pin the trigger and the shape of
 * that block so the regression is visible if either drifts.
 */

describe("recognising a study request", () => {
  it.each([
    "Explain this page to me",
    "Make study notes for this",
    "Show me the important parts",
    "What should I remember for the exam?",
    "explain this section",
    "teach me this page",
    "annotate this page",
    "walk me through this",
    "what will I be tested on",
    "break this down for me",
  ])("fires on %j", (text) => {
    expect(isStudyAnnotationRequest(text)).toBe(true)
  })

  it.each([
    "What page am I on?",
    "How many pages is this?",
    "Who wrote this document?",
    "What is the title?",
    "highlight the summary table",
    "go to page 3",
  ])("stays out of the way for %j", (text) => {
    expect(isStudyAnnotationRequest(text)).toBe(false)
  })
})

describe("shaping the pass to the request", () => {
  it("leans on marks when asked to show what matters", () => {
    expect(studyPassShape("show me the important parts").emphasis).toBe("marks")
  })

  it("leans on notes when asked to explain", () => {
    expect(studyPassShape("explain this page to me").emphasis).toBe("notes")
  })

  it("uses exam framing when revising", () => {
    expect(studyPassShape("what should I remember for the exam").voice).toBe("exam")
  })

  it("uses plain words for a beginner", () => {
    expect(studyPassShape("explain this like I'm a beginner").voice).toBe("plain")
  })
})

describe("the instruction block", () => {
  const block = buildStudyPassInstruction("Explain this page to me", { page: 2 })

  it("demands tags rather than prose", () => {
    expect(block).toContain("REQUIRED OUTPUT")
    expect(block).toContain("[highlight-current:")
    expect(block).toContain("[circle-heading:")
  })

  it("asks only for marks — the explaining happens in the reply", () => {
    // Margin notes and their arrows were removed: they landed on the text, the
    // arrows crossed the page, and the explanation reads better in the chat.
    expect(block).not.toContain("[note:")
    expect(block).toContain("explain them in your reply")
  })

  it("names the page in view", () => {
    expect(block).toContain("page 2")
  })

  it("insists the target is verbatim, which is what makes it findable", () => {
    expect(block.toLowerCase()).toContain("verbatim")
  })

  it("limits a section-scoped pass to that section", () => {
    const scoped = buildStudyPassInstruction("explain this section", {
      page: 2,
      scope: "The Calvin Cycle",
    })
    expect(scoped).toContain("ONLY")
    expect(scoped).toContain("The Calvin Cycle")
  })

  it("stays short enough not to become the wall of text that failed", () => {
    expect(block.length).toBeLessThan(1200)
  })
})

describe("rewriting one note", () => {
  const block = buildRegenerateNoteInstruction({
    text: "CO2 is fixed here!",
    target: "RuBisCO grabs CO",
    ask: "Explain that more.",
  })

  it("pins the model to the same target", () => {
    expect(block).toContain('"RuBisCO grabs CO"')
  })

  it("asks for exactly one tag and no re-annotation", () => {
    expect(block).toContain("exactly one tag")
    expect(block).toContain("Do not re-annotate")
  })
})

describe("exporting the annotated page", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])

  it("writes a PDF", async () => {
    const blob = buildAnnotatedPdf([{ jpeg, width: 800, height: 1130 }])
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 8)
    expect(String.fromCharCode(...head)).toContain("%PDF-1.4")
    expect(blob.type).toBe("application/pdf")
  })

  it("ends with a trailer and EOF", async () => {
    const blob = buildAnnotatedPdf([{ jpeg, width: 800, height: 1130 }])
    const text = new TextDecoder("latin1").decode(await blob.arrayBuffer())
    expect(text).toContain("trailer")
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
  })

  it("declares one page object per page", async () => {
    const blob = buildAnnotatedPdf([
      { jpeg, width: 800, height: 1130 },
      { jpeg, width: 800, height: 1130 },
      { jpeg, width: 600, height: 900 },
    ])
    const text = new TextDecoder("latin1").decode(await blob.arrayBuffer())
    expect(text.match(/\/Type \/Page[^s]/g) ?? []).toHaveLength(3)
    expect(text).toContain("/Count 3")
  })

  it("puts the page box at the image size", async () => {
    const blob = buildAnnotatedPdf([{ jpeg, width: 612, height: 792 }])
    const text = new TextDecoder("latin1").decode(await blob.arrayBuffer())
    expect(text).toContain("/MediaBox [0 0 612 792]")
  })

  it("embeds the JPEG without re-encoding it", async () => {
    const blob = buildAnnotatedPdf([{ jpeg, width: 10, height: 10 }])
    const text = new TextDecoder("latin1").decode(await blob.arrayBuffer())
    expect(text).toContain("/Filter /DCTDecode")
    expect(text).toContain(`/Length ${jpeg.length}`)
  })

  it("offsets in the xref table point at real objects", async () => {
    // A PDF whose xref is even one byte out opens in some readers and not
    // others, which is a miserable bug to find later.
    const blob = buildAnnotatedPdf([{ jpeg, width: 800, height: 1130 }])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder("latin1").decode(bytes)
    const xrefAt = Number(text.match(/startxref\s+(\d+)/)![1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref")

    const rows = text.slice(xrefAt).match(/^(\d{10}) 00000 n $/gm) ?? []
    expect(rows.length).toBe(5)
    rows.forEach((row, i) => {
      const at = Number(row.slice(0, 10))
      expect(text.slice(at)).toMatch(new RegExp(`^${i + 1} 0 obj`))
    })
  })

  it("refuses an empty export rather than writing a broken file", () => {
    expect(() => buildAnnotatedPdf([])).toThrow()
  })

  it("names the copy without overwriting the original", () => {
    expect(annotatedFilename("Photosynthesis The Two-Stage Process.pdf")).toBe(
      "Photosynthesis The Two-Stage Process (annotated).pdf",
    )
  })
})

describe("instructions are not search targets", () => {
  // Reported: "Circle the key terms on this page and explain what each one
  // means" searched the page for "key terms on this page" and "explain what
  // each one means", then drew a circle round whatever fuzzily matched.
  const PLANNING = "Circle the key terms on this page and explain what each one means"

  it("treats the request as a planning turn", () => {
    expect(isStudyAnnotationRequest(PLANNING)).toBe(true)
  })

  it("tells the model not to quote the request back", () => {
    const block = buildStudyPassInstruction(PLANNING, { page: 1 })
    expect(block).toContain("NEVER target words from this request")
  })

  it("still explains the terms it marks, in the reply", () => {
    const block = buildStudyPassInstruction(PLANNING, { page: 1 })
    expect(block).toContain("explain them in your reply")
  })
})

describe("phrases that describe the job are not searchable", () => {
  it.each([
    "circle the key terms on this page",
    "highlight the important parts",
    "mark the main ideas",
    "underline what each one means",
  ])("%j yields no search target", (text) => {
    expect(extractHighlightPhrases(text)).toEqual([])
  })

  it("still extracts a real phrase from a direct request", () => {
    expect(extractHighlightPhrases("circle Photolysis of Water")).toEqual(["Photolysis of Water"])
  })
})
