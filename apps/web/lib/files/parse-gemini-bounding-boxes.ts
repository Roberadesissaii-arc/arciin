import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"

type GeminiBox = {
  box_2d?: number[]
  box2d?: number[]
  bbox?: number[]
  label?: string
}

function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1000, Math.round(n)))
}

/** Tall narrow boxes are usually text columns, not row objects (cars, glasses). */
export function isLikelyColumnStrip(region: ImageHighlightRegion): boolean {
  const w = region.x2 - region.x1
  const h = region.y2 - region.y1
  if (h < 100 || w < 1) return false
  return (h > 320 && w < 160) || h / w > 3.2
}

function boxToRegion(box: number[], label?: string): ImageHighlightRegion | null {
  if (box.length < 4) return null
  const [a, b, c, d] = box.map(Number)
  if (![a, b, c, d].every(Number.isFinite)) return null

  // Gemini docs: [ymin, xmin, ymax, xmax] normalized 0–1000
  let y0: number
  let x0: number
  let y1: number
  let x1: number

  if (a <= 1000 && b <= 1000 && c <= 1000 && d <= 1000 && c >= a && d >= b) {
    y0 = a
    x0 = b
    y1 = c
    x1 = d
  } else {
    // Fallback: [xmin, ymin, xmax, ymax]
    x0 = a
    y0 = b
    x1 = c
    y1 = d
  }

  const left = clampCoord(Math.min(x0, x1))
  const top = clampCoord(Math.min(y0, y1))
  const right = clampCoord(Math.max(x0, x1))
  const bottom = clampCoord(Math.max(y0, y1))
  if (right - left < 4 || bottom - top < 4) return null

  const trimmed = label?.trim()
  return {
    ...(trimmed ? { label: trimmed.slice(0, 48) } : {}),
    x1: left,
    y1: top,
    x2: right,
    y2: bottom,
  }
}

function collectBoxesFromParsed(parsed: unknown, out: ImageHighlightRegion[], seen: Set<string>) {
  if (!parsed || typeof parsed !== "object") return

  const record = parsed as Record<string, unknown>
  const list =
    (Array.isArray(record.boxes) && record.boxes) ||
    (Array.isArray(record.items) && record.items) ||
    (Array.isArray(parsed) ? parsed : null)

  if (!list) return

  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const box = item as GeminiBox
    const coords = box.box_2d ?? box.box2d ?? box.bbox
    if (!Array.isArray(coords)) continue
    const region = boxToRegion(coords, box.label)
    if (!region) continue
    const key = `${region.label ?? ""}:${region.x1},${region.y1},${region.x2},${region.y2}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(region)
  }
}

/** Parse Gemini object-detection JSON (box_2d: [ymin, xmin, ymax, xmax] on 0–1000 scale). */
export function parseGeminiBoundingBoxes(text: string): ImageHighlightRegion[] {
  const out: ImageHighlightRegion[] = []
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (m[1]?.trim()) candidates.push(m[1].trim())
  }

  const rawJson = text.match(/\{[\s\S]*"boxes"[\s\S]*\}/)
  if (rawJson?.[0]) candidates.push(rawJson[0])

  for (const candidate of candidates) {
    try {
      collectBoxesFromParsed(JSON.parse(candidate), out, seen)
    } catch {
      /* not valid JSON */
    }
  }

  return out.filter((region) => !isLikelyColumnStrip(region))
}
