import { describe, expect, it } from "vitest"

import { buildCoverPrompt } from "@arciin/shared"

/**
 * The prompt behind a generated cover.
 *
 * A shelf of PDFs rendered as their own first page is a shelf of grey
 * rectangles. A cover has to work at card size, which is why this asks for one
 * subject and forbids lettering — generated text is the fastest way to make a
 * thumbnail look wrong, and the card already prints the title underneath.
 */

describe("building a cover prompt", () => {
  const prompt = buildCoverPrompt({
    filename: "Photosynthesis The Two-Stage Process.pdf",
    excerpt: "Photosynthesis is the biochemical pathway by which green plants convert light energy.",
  })

  it("names the document", () => {
    expect(prompt).toContain("Photosynthesis The Two-Stage Process")
  })

  it("drops the extension, which is not part of the title", () => {
    expect(prompt).not.toContain(".pdf")
  })

  it("tells the model what the document is about", () => {
    expect(prompt).toContain("green plants convert light energy")
  })

  it("forbids lettering", () => {
    expect(prompt).toContain("No text")
    expect(prompt).toContain("no watermarks")
  })

  it("asks for something readable at thumbnail size", () => {
    expect(prompt).toContain("thumbnail")
    expect(prompt).toContain("One clear focal subject")
  })

  it("works with no readable text at all", () => {
    const bare = buildCoverPrompt({ filename: "Scan 2024.pdf", excerpt: "" })
    expect(bare).toContain("Scan 2024")
    expect(bare).not.toContain("It is about:")
  })

  it("caps how much of the document it sends", () => {
    const long = buildCoverPrompt({ filename: "Book.pdf", excerpt: "x".repeat(20_000) })
    expect(long.length).toBeLessThan(4_600)
  })

  it("collapses whitespace so the excerpt reads as prose", () => {
    const messy = buildCoverPrompt({ filename: "A.pdf", excerpt: "one\n\n  two\t\tthree" })
    expect(messy).toContain("one two three")
  })
})

describe("the excerpt is document text, not reader instructions", () => {
  // readPdfAssetContent prefixes the page text with guidance written for the
  // chat model. Left in, a cover was drawn partly from instructions about
  // [goto-page:N] rather than from the document.
  function stripReaderPreamble(content: string): string {
    const firstPage = content.indexOf("--- PDF page")
    const body = firstPage >= 0 ? content.slice(firstPage) : content
    return body.replace(/^---\s*PDF page[^\n]*\n?/gm, " ").trim()
  }

  const RAW = [
    "Viewer status bar shows PDF page X / total (not printed page).",
    "Use PDF page in [goto-page:N] and [highlight:N:…].",
    "--- PDF page 1 ---",
    "Photosynthesis: The Two-Stage Process",
    "Photosynthesis is the biochemical pathway by which green plants convert light.",
  ].join("\n")

  it("drops the instructions written for the chat model", () => {
    const out = stripReaderPreamble(RAW)
    expect(out).not.toContain("goto-page")
    expect(out).not.toContain("status bar")
  })

  it("keeps the document text", () => {
    expect(stripReaderPreamble(RAW)).toContain("biochemical pathway")
  })

  it("removes the page separators too", () => {
    expect(stripReaderPreamble(RAW)).not.toContain("--- PDF page")
  })

  it("leaves text that never had a preamble alone", () => {
    expect(stripReaderPreamble("Just the document.")).toBe("Just the document.")
  })
})

describe("art-directing the cover with a text model", () => {
  it("asks for one drawable sentence", async () => {
    const { buildCoverBriefInstruction } = await import("@arciin/shared")
    const brief = buildCoverBriefInstruction("Photosynthesis The Two-Stage Process.pdf")
    expect(brief).toContain("ONE sentence")
    expect(brief).toContain("one concrete subject")
    expect(brief).toContain("Under 30 words")
  })

  it("forbids the things that ruin a thumbnail", async () => {
    const { buildCoverBriefInstruction } = await import("@arciin/shared")
    const brief = buildCoverBriefInstruction("A.pdf")
    // Labels are what the image model produced when handed raw document prose.
    expect(brief).toContain("No words, letters, numbers, labels")
    expect(brief).toContain("No mention of the title")
  })

  it("keeps style rules out of the brief and applies them itself", async () => {
    const { buildCoverPromptFromBrief } = await import("@arciin/shared")
    const prompt = buildCoverPromptFromBrief("A chloroplast lit by shafts of sunlight.")
    expect(prompt).toContain("A chloroplast lit by shafts of sunlight.")
    expect(prompt).toContain("No text, no lettering")
    expect(prompt).toContain("readable as a small thumbnail")
  })

  it("strips quoting a model wraps its answer in", async () => {
    const { buildCoverPromptFromBrief } = await import("@arciin/shared")
    expect(buildCoverPromptFromBrief('"A green leaf cell."')).toMatch(/^A green leaf cell\./)
  })

  it("collapses a brief that arrived across lines", async () => {
    const { buildCoverPromptFromBrief } = await import("@arciin/shared")
    expect(buildCoverPromptFromBrief("A leaf\n  cell")).toContain("A leaf cell")
  })
})
