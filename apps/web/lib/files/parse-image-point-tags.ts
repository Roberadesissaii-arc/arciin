import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"

const POINT_BOX_TAG =
  /\[point-box:(?:"([^"]*)"|'([^']*)')\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\]/gi

const POINT_BOX_NO_LABEL =
  /\[point-box:(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\]/gi

/** Uniform grid cell — row/col are 1-based. Optional rows/cols default to 3×4. */
const POINT_GRID_TAG =
  /\[point-grid:(?:"([^"]*)"|'([^']*)')\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})(?:\s*,\s*(\d{1,2})\s*,\s*(\d{1,2}))?\]/gi

/** Legacy / model-invented tag: [highlight-image:assetId:x,y,w,h] with 0–1 normalized coords. */
const HIGHLIGHT_IMAGE_TAG =
  /\[highlight-image:[^:\]]+:(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\]/gi

const ALL_POINT_TAGS = new RegExp(
  POINT_BOX_TAG.source +
    "|" +
    POINT_BOX_NO_LABEL.source +
    "|" +
    POINT_GRID_TAG.source +
    "|" +
    HIGHLIGHT_IMAGE_TAG.source,
  "gi",
)

function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1000, Math.round(n)))
}

function normalizeBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label?: string,
): ImageHighlightRegion | null {
  const left = clampCoord(Math.min(x1, x2))
  const top = clampCoord(Math.min(y1, y2))
  const right = clampCoord(Math.max(x1, x2))
  const bottom = clampCoord(Math.max(y1, y2))
  if (right - left < 4 || bottom - top < 4) return null
  const trimmed = label?.trim()
  return {
    ...(trimmed ? { label: trimmed } : {}),
    x1: left,
    y1: top,
    x2: right,
    y2: bottom,
  }
}

function gridCellBox(
  row: number,
  col: number,
  rows: number,
  cols: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const safeRows = Math.max(1, rows)
  const safeCols = Math.max(1, cols)
  const r = Math.max(1, Math.min(safeRows, row))
  const c = Math.max(1, Math.min(safeCols, col))
  const inset = 0.04
  const cellW = 1000 / safeCols
  const cellH = 1000 / safeRows
  return {
    x1: (c - 1) * cellW + cellW * inset,
    y1: (r - 1) * cellH + cellH * inset,
    x2: c * cellW - cellW * inset,
    y2: r * cellH - cellH * inset,
  }
}

export function regionFromGrid(
  row: number,
  col: number,
  rows = 3,
  cols = 4,
  label?: string,
): ImageHighlightRegion | null {
  const box = gridCellBox(row, col, rows, cols)
  return normalizeBox(box.x1, box.y1, box.x2, box.y2, label)
}

function regionKey(r: ImageHighlightRegion): string {
  const label = (r.label ?? "").toLowerCase()
  return `${label}:${r.x1},${r.y1},${r.x2},${r.y2}`
}

function pushRegion(out: ImageHighlightRegion[], seen: Set<string>, region: ImageHighlightRegion | null) {
  if (!region) return
  const key = regionKey(region)
  if (seen.has(key)) return
  seen.add(key)
  out.push(region)
}

function fractionTo1000(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 1) return clampCoord(Math.round(n * 1000))
  return clampCoord(Math.round(n))
}

function regionFromFractionRect(
  x: number,
  y: number,
  w: number,
  h: number,
  label?: string,
): ImageHighlightRegion | null {
  const x1 = fractionTo1000(x)
  const y1 = fractionTo1000(y)
  const x2 = fractionTo1000(x + w)
  const y2 = fractionTo1000(y + h)
  return normalizeBox(x1, y1, x2, y2, label)
}

export function parseAssistantImageRegions(text: string): ImageHighlightRegion[] {
  const out: ImageHighlightRegion[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  POINT_BOX_TAG.lastIndex = 0
  while ((m = POINT_BOX_TAG.exec(text)) !== null) {
    const label = (m[1] ?? m[2] ?? "").trim()
    pushRegion(
      out,
      seen,
      normalizeBox(
        Number.parseInt(m[3]!, 10),
        Number.parseInt(m[4]!, 10),
        Number.parseInt(m[5]!, 10),
        Number.parseInt(m[6]!, 10),
        label,
      ),
    )
  }

  POINT_BOX_NO_LABEL.lastIndex = 0
  while ((m = POINT_BOX_NO_LABEL.exec(text)) !== null) {
    pushRegion(
      out,
      seen,
      normalizeBox(
        Number.parseInt(m[1]!, 10),
        Number.parseInt(m[2]!, 10),
        Number.parseInt(m[3]!, 10),
        Number.parseInt(m[4]!, 10),
      ),
    )
  }

  POINT_GRID_TAG.lastIndex = 0
  while ((m = POINT_GRID_TAG.exec(text)) !== null) {
    const label = (m[1] ?? m[2] ?? "").trim()
    const row = Number.parseInt(m[3]!, 10)
    const col = Number.parseInt(m[4]!, 10)
    const rows = m[5] ? Number.parseInt(m[5], 10) : 3
    const cols = m[6] ? Number.parseInt(m[6], 10) : 4
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue
    const box = gridCellBox(row, col, rows, cols)
    pushRegion(out, seen, normalizeBox(box.x1, box.y1, box.x2, box.y2, label))
  }

  HIGHLIGHT_IMAGE_TAG.lastIndex = 0
  while ((m = HIGHLIGHT_IMAGE_TAG.exec(text)) !== null) {
    const x = Number.parseFloat(m[1]!)
    const y = Number.parseFloat(m[2]!)
    const w = Number.parseFloat(m[3]!)
    const h = Number.parseFloat(m[4]!)
    pushRegion(out, seen, regionFromFractionRect(x, y, w, h))
  }

  return out
}

export function stripImagePointTags(text: string): string {
  return text.replace(ALL_POINT_TAGS, "").replace(/\n{3,}/g, "\n\n")
}
