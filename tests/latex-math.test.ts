import { describe, expect, it } from "vitest"

import {
  extractBlockMath,
  hasInlineMath,
  latexToReadableText,
  looksLikeMath,
  readMathBlockPlaceholder,
  splitInlineMath,
} from "@arciin/shared"

/**
 * Assistant replies contain LaTeX. These tests pin down which spans count as
 * mathematics — the part that has to be right before KaTeX is even involved.
 */

describe("extractBlockMath", () => {
  it("lifts a multi-line display equation into one placeholder line", () => {
    const input = [
      "Einstein's field equations:",
      "",
      "\\[",
      "R_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}",
      "\\]",
      "",
      "The left side is the Einstein tensor.",
    ].join("\n")

    const result = extractBlockMath(input)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toBe(
      "R_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}",
    )

    const lines = result.text.split("\n")
    const placeholderLines = lines.filter((l) => readMathBlockPlaceholder(l) !== null)
    expect(placeholderLines).toHaveLength(1)
    expect(readMathBlockPlaceholder(placeholderLines[0]!)).toBe(0)
    // Surrounding prose survives untouched.
    expect(result.text).toContain("Einstein's field equations:")
    expect(result.text).toContain("The left side is the Einstein tensor.")
  })

  it("handles the single-line form", () => {
    const result = extractBlockMath("\\[ E = mc^2 \\]")
    expect(result.blocks).toEqual(["E = mc^2"])
  })

  it("handles $$ delimiters", () => {
    const result = extractBlockMath(["$$", "a^2 + b^2 = c^2", "$$"].join("\n"))
    expect(result.blocks).toEqual(["a^2 + b^2 = c^2"])
  })

  it("handles several equations in one document", () => {
    const result = extractBlockMath(
      ["\\[ a = b \\]", "prose", "$$", "c = d", "$$"].join("\n"),
    )
    expect(result.blocks).toEqual(["a = b", "c = d"])
    expect(result.text).toContain("prose")
  })

  it("leaves an unclosed block as plain text — replies stream in", () => {
    // Every formula passes through this state character by character. Treating
    // a lone opener as math would swallow the rest of the document mid-stream.
    const partial = ["Here it is:", "\\[", "R_{\\mu"].join("\n")
    const result = extractBlockMath(partial)
    expect(result.blocks).toEqual([])
    expect(result.text).toBe(partial)
  })

  it("never treats fenced code as math", () => {
    const input = [
      "```bash",
      'echo "pid is $$"',
      "```",
      "```latex",
      "\\[ x = 1 \\]",
      "```",
    ].join("\n")

    const result = extractBlockMath(input)
    expect(result.blocks).toEqual([])
    expect(result.text).toBe(input)
  })

  it("resumes finding math after a fence closes", () => {
    const input = ["```", "$$ not math $$", "```", "\\[ y = 2 \\]"].join("\n")
    const result = extractBlockMath(input)
    expect(result.blocks).toEqual(["y = 2"])
  })

  it("does not open a block on a delimiter mid-sentence", () => {
    // Inline math is a different rule; a block must start its own line.
    const input = "The cost is \\[bracketed\\] inline text"
    const result = extractBlockMath(input)
    expect(result.blocks).toEqual([])
  })

  it("returns the input unchanged when there is no math", () => {
    const input = "Just prose.\n\nMore prose."
    expect(extractBlockMath(input)).toEqual({ text: input, blocks: [] })
  })
})

describe("readMathBlockPlaceholder", () => {
  it("recognises its own placeholders and nothing else", () => {
    const { text } = extractBlockMath("\\[ x \\]")
    expect(readMathBlockPlaceholder(text)).toBe(0)
    expect(readMathBlockPlaceholder("ordinary line")).toBeNull()
    expect(readMathBlockPlaceholder("arciin-math-0")).toBeNull()
  })
})

describe("looksLikeMath", () => {
  it("accepts real inline maths", () => {
    expect(looksLikeMath("x^2")).toBe(true)
    expect(looksLikeMath("\\alpha")).toBe(true)
    expect(looksLikeMath("a_{ij}")).toBe(true)
  })

  it("rejects currency, which is why single-dollar math is guarded", () => {
    expect(looksLikeMath("5 to ")).toBe(false)
    expect(looksLikeMath("100")).toBe(false)
    expect(looksLikeMath("19.99 per month and ")).toBe(false)
  })

  it("rejects padded content, which reads as prose spacing", () => {
    expect(looksLikeMath(" x^2 ")).toBe(false)
  })

  it("rejects empty content", () => {
    expect(looksLikeMath("")).toBe(false)
    expect(looksLikeMath("   ")).toBe(false)
  })
})

describe("splitInlineMath", () => {
  it("splits \\( … \\) out of a sentence", () => {
    const segments = splitInlineMath("the divergence of \\( T^{\\mu\\nu} \\) vanishes")
    expect(segments).toEqual([
      { type: "text", value: "the divergence of " },
      { type: "math", value: "T^{\\mu\\nu}" },
      { type: "text", value: " vanishes" },
    ])
  })

  it("handles several formulas in one line", () => {
    const segments = splitInlineMath("\\(a\\) and \\(b\\)")
    expect(segments.filter((s) => s.type === "math").map((s) => s.value)).toEqual(["a", "b"])
  })

  it("accepts $…$ when the content looks like maths", () => {
    const segments = splitInlineMath("where $x^2$ appears")
    expect(segments.filter((s) => s.type === "math").map((s) => s.value)).toEqual(["x^2"])
  })

  it("leaves currency alone", () => {
    // The classic false positive: "$5 to $10" would otherwise render "5 to "
    // as an equation.
    const input = "it costs $5 to $10 per month"
    expect(splitInlineMath(input)).toEqual([{ type: "text", value: input }])
    expect(hasInlineMath(input)).toBe(false)
  })

  it("handles $$…$$ used inline", () => {
    const segments = splitInlineMath("value $$E = mc^2$$ here")
    expect(segments.filter((s) => s.type === "math").map((s) => s.value)).toEqual(["E = mc^2"])
  })

  it("leaves an unclosed inline delimiter as text", () => {
    const input = "partial \\(x^2"
    expect(splitInlineMath(input)).toEqual([{ type: "text", value: input }])
  })

  it("returns the whole line as text when there is no math", () => {
    expect(splitInlineMath("plain sentence")).toEqual([
      { type: "text", value: "plain sentence" },
    ])
  })

  it("preserves surrounding whitespace exactly", () => {
    const segments = splitInlineMath("a \\(x\\) b")
    expect(segments.map((s) => s.value).join("")).toBe("a x b")
  })

  it("trims padding inside the delimiters", () => {
    expect(splitInlineMath("\\(  x^2  \\)")[0]).toEqual({ type: "math", value: "x^2" })
  })
})

describe("KaTeX rendering options are a security boundary", () => {
  // The rendered HTML is injected with dangerouslySetInnerHTML, so these two
  // options are what stand between a formula and script execution. A formula
  // can arrive from the model or from a document the model is quoting.
  const options = { throwOnError: false, trust: false } as const

  it("renders \\href as inert text rather than a link", async () => {
    const katex = (await import("katex")).default
    const html = katex.renderToString("\\href{javascript:alert(1)}{click me}", options)

    expect(html).not.toMatch(/<a[\s>]/i)
    expect(html).not.toMatch(/href\s*=/i)
    expect(html).not.toMatch(/(href|src)\s*=\s*["']?\s*javascript:/i)
  })

  it("would produce a real link if trust were enabled — the option is load-bearing", async () => {
    // Guards against someone "simplifying" trust: false away as a default.
    const katex = (await import("katex")).default
    const trusted = katex.renderToString("\\href{https://example.com}{x}", {
      throwOnError: false,
      trust: true,
    })
    expect(trusted).toMatch(/<a[\s>]/i)
  })

  it("does not throw on half-written LaTeX", async () => {
    // Every streamed formula passes through states like this.
    const katex = (await import("katex")).default
    expect(() => katex.renderToString("R_{\\mu", options)).not.toThrow()
    expect(() => katex.renderToString("\\frac{1}", options)).not.toThrow()
    expect(() => katex.renderToString("", options)).not.toThrow()
  })

  it("renders the tensor equation with real math markup", async () => {
    const katex = (await import("katex")).default
    const html = katex.renderToString(
      "R_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}",
      { ...options, displayMode: true },
    )
    expect(html).toContain("frac-line")
    expect(html).toContain("μ")
    expect(html).toContain("ν")
  })
})

describe("latexToReadableText — the export fallback", () => {
  // The Canvas PDF writer emits PDF operators by hand with Latin-1 Times
  // fonts: no Greek, no fraction bars. It cannot typeset maths, so the goal
  // here is readable, not beautiful — and never raw backslashes.

  it("reads a fraction the way a person would say it", () => {
    expect(latexToReadableText("\\frac{1}{2}")).toBe("(1)/(2)")
  })

  it("handles a fraction whose numerator contains braces", () => {
    // A plain regex collapses this to "fracphi^n2" because [^{}]* stops at the
    // superscript's brace. Balanced-brace parsing is what fixes it.
    expect(latexToReadableText("F_n = \\frac{\\phi^n - (-\\phi)^{-n}}{\\sqrt{5}}")).toBe(
      "F_n = (phi^n - (-phi)^(-n))/(sqrt(5))",
    )
  })

  it("handles a fraction containing a root", () => {
    expect(latexToReadableText("\\frac{1 + \\sqrt{5}}{2}")).toBe("(1 + sqrt(5))/(2)")
  })

  it("expands sums with bounds", () => {
    expect(latexToReadableText("L = \\sum_{n=1}^{\\infty} 10^{-n!}")).toBe(
      "L = sum from n=1 to infinity of 10^(-n!)",
    )
  })

  it("names Greek letters instead of dropping them", () => {
    expect(latexToReadableText("R_{\\mu\\nu}")).toBe("R_munu")
    expect(latexToReadableText("8\\pi G")).toBe("8pi G")
  })

  it("keeps superscripts as ASCII carets", () => {
    // Unicode ² read better but the PDF writer encodes UTF-8 into a Times font
    // with no /Encoding entry, so those bytes rendered as daggers.
    expect(latexToReadableText("\\phi^2 = \\phi + 1")).toBe("phi^2 = phi + 1")
  })

  it("keeps a root wrapped around a fraction as one quantity", () => {
    // sqrt(GM)/(r) is a DIFFERENT formula from sqrt((GM)/(r)), and nothing in
    // the output would tell the reader it had changed.
    expect(latexToReadableText("v_{circ} = \\sqrt{\\frac{GM}{r}}")).toBe(
      "v_circ = sqrt((GM)/(r))",
    )
  })

  it("reads astronomical subscripts as words", () => {
    expect(latexToReadableText("\\frac{V_\\odot}{V_\\oplus}")).toBe("(V_sun)/(V_earth)")
  })

  it("converts comparison symbols", () => {
    expect(latexToReadableText("M \\gg m")).toBe("M >> m")
  })

  it("does not leave a stray slash from a LaTeX thin space", () => {
    expect(latexToReadableText("1.90 \\times 10^{27}\\ \\text{kg}")).toBe(
      "1.90 x 10^(27) kg",
    )
  })

  it("strips \\text and \\left/\\right wrappers", () => {
    expect(latexToReadableText("\\left( \\text{prime} \\right)")).toContain("prime")
    expect(latexToReadableText("\\left( x \\right)")).not.toContain("\\")
  })

  it("never leaves a stray backslash for the reader to decode", () => {
    const samples = [
      "\\frac{8\\pi G}{c^4} T_{\\mu\\nu}",
      "\\sum_{p, p+2 \\text{ prime}} \\left( \\frac{1}{p} + 1 \\right)",
      "\\phi = \\frac{1 + \\sqrt{5}}{2} \\approx 1.618",
    ]
    for (const sample of samples) {
      expect(latexToReadableText(sample)).not.toContain("\\")
    }
  })

  it("emits ASCII only — the PDF stream is UTF-8 into a font with no /Encoding", () => {
    // The earlier version of this test asserted Latin-1, which was the wrong
    // property: a Latin-1 character still encodes as two UTF-8 bytes and both
    // render as the wrong glyph.
    const out = latexToReadableText(
      "\\frac{\\alpha^2}{\\beta} \\pm \\sqrt{\\gamma} \\cdot \\infty \\approx \\pi",
    )
    expect(out).toMatch(/^[\x20-\x7E]*$/)
  })
})
