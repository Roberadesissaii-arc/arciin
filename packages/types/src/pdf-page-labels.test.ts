import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  buildPdfPageIndex,
  extractFooterLabels,
  extractPageLabels,
  findPdfPageForChapter,
  findPdfPageForPrintedPage,
  formatPdfPageMarker,
} from "./pdf-page-labels"

describe("extractFooterLabels", () => {
  it("parses footer with chapter and title", () => {
    const text =
      "Some body text\n14 | Chapter 2: Basic Application Structure"
    assert.deepEqual(extractFooterLabels(text), {
      printedPage: 14,
      chapter: 2,
      chapterTitle: "Basic Application Structure",
    })
  })

  it("parses printed page without conflating chapter number", () => {
    const text = "content\n43 | Chapter 4: Web Forms"
    assert.deepEqual(extractFooterLabels(text), {
      printedPage: 43,
      chapter: 4,
      chapterTitle: "Web Forms",
    })
  })
})

describe("chapter navigation index", () => {
  it("maps chapter 4 to PDF page 65 when index built from labels", () => {
    const labels = [
      extractPageLabels(37, "14 | Chapter 2: Basic Application Structure"),
      extractPageLabels(
        65,
        "CHAPTER 4\nWeb Forms\nIntro paragraph about Chapter 3.",
      ),
      extractPageLabels(66, "Flask-WTF package.\n43 | Chapter 4: Web Forms"),
    ].map((l, i) => ({
      ...l,
      pdfPage: [37, 65, 66][i]!,
      isChapterStart: i === 1 ? true : l.isChapterStart,
    }))

    const index = buildPdfPageIndex(labels)
    assert.equal(findPdfPageForChapter(index, 4), 66)
    assert.equal(findPdfPageForPrintedPage(index, 43), 66)
  })

  it("formats page marker with both numbers", () => {
    assert.equal(
      formatPdfPageMarker(66, {
        printedPage: 43,
        chapter: 4,
        chapterTitle: "Web Forms",
      }),
      "--- PDF page 66 · printed page 43 · Chapter 4: Web Forms ---",
    )
  })
})
