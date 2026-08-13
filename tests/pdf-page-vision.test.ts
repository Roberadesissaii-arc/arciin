import { describe, expect, it } from "vitest"

import { buildPageVisionInstruction } from "@/lib/files/render-pdf-page-image"
import { isStudyAnnotationRequest } from "@/lib/files/pdf-study-request"

/**
 * Showing the model the page it is annotating.
 *
 * Reading the text layer tells the assistant what the page says and nothing
 * about how it sits — which is why a mark landed on blank paper beside a
 * formula, and why notes were planned for margins too thin to hold them. The
 * image is there to inform the *choice* of target.
 *
 * The division of labour is the important part and is what these pin down:
 * the model looks and decides, the text layer resolves, and coordinates are
 * never asked for. A model that guesses pixel positions is the failure this
 * whole pipeline was built to avoid.
 */

describe("the page-image instruction", () => {
  const block = buildPageVisionInstruction()

  it("says what the image is", () => {
    expect(block).toContain("this page as the student sees it")
  })

  it("asks for the judgements the text layer cannot give", () => {
    expect(block).toContain("headings")
    expect(block).toContain("empty space")
  })

  it("still requires targets to be verbatim page text", () => {
    expect(block).toContain("EXACTLY")
    expect(block.toLowerCase()).toContain("text layer")
  })

  it("forbids coordinates outright", () => {
    // The one rule that keeps targeting accurate: the model looks, but the
    // text layer decides where a phrase actually is.
    expect(block).toContain("Never give coordinates")
  })

  it("warns off the things that produced bad marks", () => {
    expect(block).toContain("formula")
    expect(block).toContain("running header")
  })

  it("is short enough to survive next to the study block", () => {
    expect(block.length).toBeLessThan(900)
  })
})

describe("when the page image is attached", () => {
  it.each([
    "Explain this page to me",
    "Circle the key terms on this page and explain what each one means",
    "What should I remember for the exam?",
    "Make study notes for this page",
  ])("a study pass carries it: %j", (text) => {
    expect(isStudyAnnotationRequest(text)).toBe(true)
  })

  it.each([
    "What page am I on?",
    "highlight the summary table",
    "go to page 3",
  ])("an ordinary turn does not: %j", (text) => {
    // Rasterising a page costs real time and vision tokens cost real money;
    // neither is worth spending on a turn that does not plan annotations.
    expect(isStudyAnnotationRequest(text)).toBe(false)
  })
})
