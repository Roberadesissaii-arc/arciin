"use client"

import { useMemo } from "react"
import katex from "katex"

import { splitInlineMath } from "@arciin/shared"
import { cn } from "@/lib/utils"

/**
 * Rendering LaTeX in assistant replies.
 *
 * KaTeX rather than MathJax: it renders synchronously to a string, which suits
 * a renderer that rebuilds on every streamed token, and it ships its own fonts
 * so nothing is fetched at runtime.
 *
 * Two options are deliberate rather than defaults worth skimming past:
 *
 *   `throwOnError: false` — replies stream in, so half-written LaTeX is a
 *   normal intermediate state, not an error. Throwing would blank the canvas on
 *   every keystroke of every formula.
 *
 *   `trust: false` — KaTeX's default, restated because it is the security
 *   boundary here. The output is injected as HTML, and `trust: true` would
 *   enable `\href` and `\includegraphics`, letting a formula in a model reply
 *   (or in a document the model is quoting) inject a link or fetch a URL.
 */

type KatexOptions = Parameters<typeof katex.renderToString>[1]

const SHARED_OPTIONS: KatexOptions = {
  throwOnError: false,
  // Malformed input renders in the error colour instead of blowing up.
  errorColor: "hsl(var(--destructive, 0 84% 60%))",
  trust: false,
  strict: false as const,
  output: "html",
}

function render(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { ...SHARED_OPTIONS, displayMode })
  } catch {
    // renderToString can still throw on pathological input even with
    // throwOnError; falling back to the source text is always safe because the
    // caller escapes it.
    return escapeHtml(latex)
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** A centred display equation. */
export function MathBlock({ latex, className }: { latex: string; className?: string }) {
  const html = useMemo(() => render(latex, true), [latex])

  return (
    <div
      className={cn(
        // Long equations scroll inside their own box rather than widening the
        // document — a derivation should never introduce a horizontal
        // scrollbar on the page itself.
        "arciin-math-block my-4 overflow-x-auto overflow-y-hidden py-1 text-center",
        className,
      )}
      // KaTeX output, produced locally with trust disabled.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Math inside a sentence. */
export function MathInline({ latex }: { latex: string }) {
  const html = useMemo(() => render(latex, false), [latex])

  return (
    <span
      className="arciin-math-inline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Apply inline math to a line, delegating every non-math run to the caller's
 * own inline parser.
 *
 * Written as a higher-order helper because the three chat renderers each have
 * their own emphasis/code/link parsing that must keep working untouched.
 */
export function renderInlineWithMath(
  text: string,
  renderText: (value: string) => React.ReactNode,
): React.ReactNode {
  const segments = splitInlineMath(text)

  if (segments.length === 1 && segments[0]!.type === "text") {
    return renderText(text)
  }

  return segments.map((segment, index) =>
    segment.type === "math" ? (
      <MathInline key={`m${index}`} latex={segment.value} />
    ) : (
      <span key={`t${index}`}>{renderText(segment.value)}</span>
    ),
  )
}
