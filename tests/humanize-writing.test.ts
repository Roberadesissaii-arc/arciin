import { describe, expect, it } from "vitest"

import {
  HUMANIZE_DIRECTIVE,
  HUMANIZE_FULL_BRIEF,
  auditHumanTells,
  humanizeInstructionFor,
  shouldHumanizeByDefault,
} from "@arciin/shared"

describe("shouldHumanizeByDefault", () => {
  it("always applies to Canvas, which is long-form by definition", () => {
    expect(shouldHumanizeByDefault({ canvas: true })).toBe(true)
    expect(shouldHumanizeByDefault({ canvas: true, userText: "hi" })).toBe(true)
  })

  it("applies to prose requests", () => {
    for (const ask of [
      "write an essay about Kepler",
      "draft a report on storage usage",
      "rewrite my intro paragraph",
      "polish this cover letter",
      "write me a blog post",
    ]) {
      expect(shouldHumanizeByDefault({ userText: ask })).toBe(true)
    }
  })

  it("stays out of the way for short factual questions", () => {
    // A one-line answer has no room to develop a rhythm worth correcting, and
    // the guidance is not worth its tokens there.
    for (const ask of ["list all my pdfs", "how much storage is left?", "what is this file?"]) {
      expect(shouldHumanizeByDefault({ userText: ask })).toBe(false)
    }
  })

  it("handles empty input", () => {
    expect(shouldHumanizeByDefault({})).toBe(false)
    expect(shouldHumanizeByDefault({ userText: "   " })).toBe(false)
  })
})

describe("humanizeInstructionFor", () => {
  it("sends nothing when off", () => {
    expect(humanizeInstructionFor("off")).toBe("")
  })

  it("sends the compact directive by default and the full brief on request", () => {
    expect(humanizeInstructionFor("default")).toBe(HUMANIZE_DIRECTIVE)
    expect(humanizeInstructionFor("explicit")).toBe(HUMANIZE_FULL_BRIEF)
    // The default rides along on every long-form turn, so it has to stay small.
    expect(HUMANIZE_DIRECTIVE.length).toBeLessThan(HUMANIZE_FULL_BRIEF.length)
  })

  it("warns against overcorrecting into forced quirkiness", () => {
    // Without this the guidance produces random fragments and fake slang,
    // which reads as its own kind of artificial.
    expect(HUMANIZE_DIRECTIVE).toMatch(/overcorrect/i)
  })
})

describe("auditHumanTells", () => {
  it("finds nothing in plain, specific prose", () => {
    const text =
      "The tunnel restarted at 19:17 and picked up a new hostname. Nobody was watching. " +
      "That is the whole problem: the link on your phone dies while you are out, and the " +
      "only copy of the new address is on a screen at home."
    expect(auditHumanTells(text)).toEqual([])
  })

  it("flags over-formal vocabulary", () => {
    const found = auditHumanTells(
      "This pivotal work delves into the intricate tapestry of the landscape.",
    )
    expect(found.find((f) => f.kind === "vocabulary")?.detail).toMatch(/delve|tapestry|pivotal/)
  })

  it("flags stock transitions and throat-clearing", () => {
    const found = auditHumanTells(
      "Furthermore, it's important to note that this matters. In conclusion, it does.",
    )
    expect(found.some((f) => f.kind === "phrase")).toBe(true)
  })

  it("flags the antithesis construction", () => {
    // The stickiest tell of all — it survives paraphrasing and model updates.
    const found = auditHumanTells("It's not a feature, it's a philosophy.")
    expect(found.some((f) => f.kind === "antithesis")).toBe(true)
    expect(auditHumanTells("This is not just fast, but reliable.").some(
      (f) => f.kind === "antithesis",
    )).toBe(true)
  })

  it("flags uniform sentence rhythm", () => {
    // Six sentences of near-identical length: the structural signal detectors
    // actually measure, and what a reader registers as monotony.
    const monotone = Array.from(
      { length: 8 },
      (_, i) => `The system handles requests and returns results for case number ${i}.`,
    ).join(" ")
    expect(auditHumanTells(monotone).some((f) => f.kind === "uniform-rhythm")).toBe(true)
  })

  it("does not flag rhythm on genuinely varied prose", () => {
    const varied =
      "It broke. The tunnel had been up for six hours when cloudflared exited without a " +
      "word, and because the process is a module-level singleton nothing noticed. Nobody " +
      "noticed. Not for a day. The link simply stopped resolving and every phone that had " +
      "it saved started returning a Cloudflare error page instead of the login screen."
    expect(auditHumanTells(varied).some((f) => f.kind === "uniform-rhythm")).toBe(false)
  })

  it("needs enough sentences before judging rhythm", () => {
    // Two similar sentences are not evidence of anything.
    expect(auditHumanTells("One short line. Another short line.")).toEqual([])
  })
})
