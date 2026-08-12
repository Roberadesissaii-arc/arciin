/**
 * The marks the assistant can draw on a page.
 *
 * One vocabulary shared by the tag parser, the request classifier and the
 * renderer, so a style cannot exist in one and be silently dropped by another.
 */

export const PDF_ANNOTATION_STYLES = [
  "highlight",
  "underline",
  "circle",
  "box",
  "strike",
] as const

export type PdfAnnotationStyle = (typeof PDF_ANNOTATION_STYLES)[number]

export const DEFAULT_ANNOTATION_STYLE: PdfAnnotationStyle = "highlight"

/**
 * What the user's own verb asks for.
 *
 * Ordered longest-first where prefixes overlap, so "cross out" is not read as
 * "cross". Every verb the request classifier accepts appears here; a verb with
 * no obvious mark falls back to highlighting.
 */
const STYLE_BY_VERB: ReadonlyArray<readonly [RegExp, PdfAnnotationStyle]> = [
  [/\bunderline[sd]?\b/i, "underline"],
  [/\bcircle[sd]?\b|\bdraw\s+(?:a\s+)?circle\b|\bring\b|\bloop\b/i, "circle"],
  [/\bbox\b|\bboxe[sd]\b|\boutline[sd]?\b|\bframe[sd]?\b|\bborder\b/i, "box"],
  [/\bcross(?:ed)?\s+out\b|\bstrike(?:\s*through)?\b|\bstruck\b/i, "strike"],
  [/\bhighlight(?:ed|s)?\b|\bmark(?:ed|s)?\b|\bcolou?r\b/i, "highlight"],
]

/**
 * The style a request asks for, or null when it names no mark at all.
 *
 * "Circle the summary table" has to draw a circle — picking the style for the
 * user is the point of the feature, and defaulting everything to a highlight
 * would make the other verbs decorative.
 */
export function styleFromRequest(userText: string): PdfAnnotationStyle | null {
  const t = userText || ""
  for (const [pattern, style] of STYLE_BY_VERB) {
    if (pattern.test(t)) return style
  }
  return null
}

/** Accepts a style name from a tag, tolerating the aliases a model will invent. */
export function normalizeAnnotationStyle(value: string | null | undefined): PdfAnnotationStyle {
  const v = (value ?? "").trim().toLowerCase()
  if ((PDF_ANNOTATION_STYLES as readonly string[]).includes(v)) return v as PdfAnnotationStyle
  if (v === "mark" || v === "colour" || v === "color") return "highlight"
  if (v === "ring" || v === "loop" || v === "pen" || v === "pencil") return "circle"
  if (v === "outline" || v === "frame" || v === "border" || v === "rect") return "box"
  if (v === "strikethrough" || v === "cross" || v === "crossout") return "strike"
  return DEFAULT_ANNOTATION_STYLE
}

/** Tag-name alternation for the parser, aliases included. */
export const ANNOTATION_TAG_NAMES =
  "highlight|underline|circle|box|strike|mark|ring|loop|pen|pencil|outline|frame|border|strikethrough"

/** How each mark reads in a sentence, for the confirmation the user sees. */
export const ANNOTATION_VERB: Record<PdfAnnotationStyle, string> = {
  highlight: "highlighted",
  underline: "underlined",
  circle: "circled",
  box: "boxed",
  strike: "struck through",
}
