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
