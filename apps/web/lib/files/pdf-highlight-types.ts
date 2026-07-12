export type PdfHighlightTarget = {
  page: number
  quote: string
  /** heading = section titles / named phrases the user asked for */
  kind?: "default" | "heading"
}

export type PdfHighlightRect = {
  left: number
  top: number
  width: number
  height: number
}
