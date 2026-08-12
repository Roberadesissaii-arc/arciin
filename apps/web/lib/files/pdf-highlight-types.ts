import type { PdfAnnotationStyle } from "@/lib/files/pdf-annotation-style"

export type PdfHighlightTarget = {
  page: number
  quote: string
  /** heading = section titles / named phrases the user asked for */
  kind?: "default" | "heading"
  /** How to draw it. Absent means highlight, which is what every caller meant
   * before the other marks existed. */
  style?: PdfAnnotationStyle
}

export type PdfHighlightRect = {
  left: number
  top: number
  width: number
  height: number
}
