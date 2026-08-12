/**
 * Keeping a study layer across reopens.
 *
 * What is stored is deliberately *not* geometry. Every annotation is a page
 * number plus the verbatim text it is attached to, and positions are resolved
 * from the live document each time it renders. That makes the layer immune to
 * everything that would otherwise break saved coordinates — zoom, window size,
 * device pixel ratio, a different machine — and it means a note cannot drift
 * away from the sentence it explains.
 *
 * The original PDF is never touched. This is a sidecar keyed by asset id.
 */

import type { PdfPageAnnotation } from "@/lib/files/pdf-annotation-layout"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

const KEY_PREFIX = "arciin.study-layer."
const VERSION = 1

/** One asset's saved layer. */
export type StudyLayer = {
  version: number
  assetId: string
  savedAt: string
  notes: PdfPageAnnotation[]
  marks: PdfHighlightTarget[]
}

/** Enough for a long study session; beyond this the sheet is unreadable anyway. */
const MAX_NOTES = 60
const MAX_MARKS = 120

function storageKey(assetId: string): string {
  return `${KEY_PREFIX}${assetId}`
}

/**
 * Validate on the way in.
 *
 * localStorage is user-writable and survives deploys, so a stored layer is
 * untrusted input: a shape change in a later version, a half-written value, or
 * hand-edited JSON must not be able to crash the viewer on open.
 */
function isNote(value: unknown): value is PdfPageAnnotation {
  if (typeof value !== "object" || value === null) return false
  const n = value as Record<string, unknown>
  return (
    typeof n.id === "string" &&
    typeof n.page === "number" &&
    Number.isFinite(n.page) &&
    n.page >= 1 &&
    typeof n.text === "string" &&
    typeof n.target === "string" &&
    typeof n.kind === "string"
  )
}

function isMark(value: unknown): value is PdfHighlightTarget {
  if (typeof value !== "object" || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.page === "number" &&
    Number.isFinite(m.page) &&
    m.page >= 1 &&
    typeof m.quote === "string" &&
    m.quote.trim().length > 0
  )
}

export function loadStudyLayer(assetId: string): StudyLayer | null {
  if (!assetId || typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(storageKey(assetId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const layer = parsed as Record<string, unknown>
    if (layer.version !== VERSION) return null

    const notes = Array.isArray(layer.notes) ? layer.notes.filter(isNote) : []
    const marks = Array.isArray(layer.marks) ? layer.marks.filter(isMark) : []
    if (notes.length === 0 && marks.length === 0) return null

    return {
      version: VERSION,
      assetId,
      savedAt: typeof layer.savedAt === "string" ? layer.savedAt : new Date().toISOString(),
      notes: notes.slice(0, MAX_NOTES),
      marks: marks.slice(0, MAX_MARKS),
    }
  } catch {
    // Corrupt or unreadable (private mode, quota, hand-edited): open clean
    // rather than failing to open at all.
    return null
  }
}

export function saveStudyLayer(
  assetId: string,
  layer: { notes: PdfPageAnnotation[]; marks: PdfHighlightTarget[] },
): void {
  if (!assetId || typeof window === "undefined") return
  try {
    // Nothing to keep: drop the entry instead of storing an empty one, so
    // "Clear" genuinely clears rather than leaving a tombstone behind.
    if (layer.notes.length === 0 && layer.marks.length === 0) {
      window.localStorage.removeItem(storageKey(assetId))
      return
    }
    const payload: StudyLayer = {
      version: VERSION,
      assetId,
      savedAt: new Date().toISOString(),
      notes: layer.notes.slice(0, MAX_NOTES),
      marks: layer.marks.slice(0, MAX_MARKS),
    }
    window.localStorage.setItem(storageKey(assetId), JSON.stringify(payload))
  } catch {
    // Quota or private mode. Losing the layer on reopen is a far smaller
    // failure than throwing while the student is reading.
  }
}

export function clearStudyLayer(assetId: string): void {
  if (!assetId || typeof window === "undefined") return
  try {
    window.localStorage.removeItem(storageKey(assetId))
  } catch {
    /* nothing useful to do */
  }
}
