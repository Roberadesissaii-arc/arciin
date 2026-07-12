/** Normalized bounding box on the image (0–1000 scale, top-left origin). */
export type ImageHighlightRegion = {
  label?: string
  x1: number
  y1: number
  x2: number
  y2: number
}
