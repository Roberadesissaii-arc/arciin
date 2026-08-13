/**
 * Where a handwritten note goes, and how its arrow reaches what it explains.
 *
 * The assistant supplies meaning — "explain this to the student" — and names the
 * text each note is about. It does not supply coordinates: a model asked for
 * pixel positions guesses them, and a note that lands on top of the paragraph it
 * is explaining is worse than no note. So placement is computed here, from the
 * real geometry of the page: the target's rect, the margins the page actually
 * has, and the notes already placed.
 *
 * Pure and unit-testable on purpose. This is the part that decides whether the
 * result reads as a tutor's marginalia or as a mess over the text.
 */

import type { PdfHighlightRect } from "@/lib/files/pdf-highlight-types"

export type PdfNoteKind =
  | "note"
  | "important"
  | "warning"
  | "definition"
  | "connection"
  | "summary"

export type PdfPageAnnotation = {
  id: string
  page: number
  kind: PdfNoteKind
  /** The handwritten text. */
  text: string
  /** Verbatim page text this note is about. Empty for a page-level summary. */
  target: string
}

export type PageGeometry = {
  /** Rendered page size in CSS pixels. */
  width: number
  height: number
  /** Bounding box of the page's own text, so margins can be found. */
  contentLeft: number
  contentRight: number
  contentTop: number
  contentBottom: number
}

export type Point = { x: number; y: number }

export type PlacedNote = {
  id: string
  kind: PdfNoteKind
  text: string
  box: { left: number; top: number; width: number }
  /** Estimated, so later notes can be stacked without overlapping. */
  height: number
  side: "left" | "right"
  /** Null for a summary, which explains the page rather than one phrase. */
  arrow: Point[] | null
}

/**
 * Roughly how wide one handwritten character is at a given size.
 *
 * Deliberately generous. Caveat is narrow, but underestimating here puts too
 * many characters on a line, and because each line is positioned individually
 * the overflow does not wrap — it runs straight out of the note and across the
 * page text, which is what happened to the margin notes on the first page.
 */
const CHAR_WIDTH_RATIO = 0.56
const LINE_HEIGHT_RATIO = 1.28

/** Never write into the very edge of the sheet. */
const EDGE_PAD = 10
/** Clear of the text column, so a note never touches the words it explains. */
const GUTTER = 14
/** Vertical breathing room between two notes in the same margin. */
const NOTE_GAP = 12

export const NOTE_FONT_SIZE = 15

/** Widest a margin note gets at 100%; scaled with the page above. */
const MAX_NOTE_WIDTH = 210

/**
 * Wrap by width, and honour the line breaks the assistant wrote.
 *
 * Short lines are the point — "CO₂ is fixed here!" over two lines reads as
 * handwriting, while the same words as one long line read as a caption.
 */
export function wrapNoteText(text: string, maxChars: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    let line = ""
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (candidate.length > maxChars && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export function measureNote(
  text: string,
  width: number,
  fontSize = NOTE_FONT_SIZE,
): { lines: string[]; height: number } {
  const maxChars = Math.max(8, Math.floor(width / (fontSize * CHAR_WIDTH_RATIO)))
  const lines = wrapNoteText(text, maxChars)
  return { lines, height: Math.max(1, lines.length) * fontSize * LINE_HEIGHT_RATIO }
}

/**
 * A hand-drawn arrow from the note to the thing it explains.
 *
 * Bowed rather than straight, and the bow always falls on the side away from the
 * text column, so the curve sweeps through empty paper instead of arcing back
 * over the words. The wobble is derived from the endpoints, so it is identical
 * on every re-render — an arrow that reshapes itself while the user reads is
 * worse than one that is too regular.
 */
export function arrowPath(from: Point, to: Point, side: "left" | "right"): Point[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy) || 1

  const seed = ((Math.round(from.x * 3 + from.y * 7 + to.x * 11) % 100) / 100 - 0.5) * 2
  // Bow away from the text column; longer arrows bow more, up to a limit.
  const bow = Math.min(38, distance * 0.22) * (side === "right" ? 1 : -1)
  const sag = Math.min(16, distance * 0.1) * seed

  const mid: Point = {
    x: (from.x + to.x) / 2 + bow * 0.35,
    y: (from.y + to.y) / 2 + sag,
  }

  // Three points: the renderer draws a quadratic through the middle one.
  return [from, mid, to]
}

function overlaps(
  top: number,
  height: number,
  taken: Array<{ top: number; bottom: number }>,
  gap: number,
) {
  return taken.some((t) => top < t.bottom + gap && top + height + gap > t.top)
}

/**
 * Place every note for one page.
 *
 * Notes go in the wider margin by default and fall back to the other side when
 * that one is full, so a page with a single narrow margin still works. A note
 * that cannot be placed anywhere without covering the text is dropped rather
 * than written over the paragraph — a lost note costs the student one
 * explanation, an unreadable page costs them the page.
 */
export function layoutPageAnnotations(
  annotations: Array<PdfPageAnnotation & { rect: PdfHighlightRect | null }>,
  page: PageGeometry,
  fontSize = NOTE_FONT_SIZE,
): PlacedNote[] {
  // Every spacing constant is written for 100% and scaled with the page.
  // Leaving them fixed makes a note occupy half the margin at 200% zoom and land
  // at a different point on the sheet than it did at 100% — the handwriting has
  // to zoom with the words it sits beside, because it is written *on* the page.
  const scale = fontSize / NOTE_FONT_SIZE
  const edgePad = EDGE_PAD * scale
  const gutter = GUTTER * scale
  const noteGap = NOTE_GAP * scale
  const maxNoteWidth = MAX_NOTE_WIDTH * scale

  const rightWidth = page.width - page.contentRight - gutter - edgePad
  const leftWidth = page.contentLeft - gutter - edgePad

  const sides: Array<{
    side: "left" | "right"
    width: number
    left: number
    alignEnd?: boolean
  }> = []
  if (rightWidth > 60 * scale) {
    sides.push({ side: "right", width: rightWidth, left: page.contentRight + gutter })
  }
  if (leftWidth > 60 * scale) {
    // Right-aligned against the text column rather than flush to the far edge,
    // so a left-hand note hugs the words it explains and uses the sheet's own
    // margin first. Placed at the outer edge it floated out on the viewer
    // background with a long arrow reaching back across the paper.
    sides.push({ side: "left", width: leftWidth, left: edgePad, alignEnd: true })
  }
  // A page typeset edge to edge has nowhere to write without covering words.
  // The old fallback dropped a note on top of the text column, which is exactly
  // the outcome the whole placement pass exists to avoid — so there is no
  // fallback: those notes are skipped, and the marks still land.
  if (sides.length === 0) return []
  sides.sort((a, b) => b.width - a.width)

  const taken: Record<"left" | "right", Array<{ top: number; bottom: number }>> = {
    left: [],
    right: [],
  }
  const placed: PlacedNote[] = []

  // Top-down, so stacking follows reading order rather than the model's order.
  const ordered = [...annotations].sort((a, b) => (a.rect?.top ?? 1e9) - (b.rect?.top ?? 1e9))

  for (const annotation of ordered) {
    const isSummary = annotation.kind === "summary" || !annotation.rect
    let done = false

    for (const side of sides) {
      const width = Math.min(side.width, maxNoteWidth)
      // A left-hand note ends where the text begins; a right-hand one starts
      // there. Both sit against the column instead of against the paper edge.
      const boxLeft = side.alignEnd
        ? Math.max(edgePad, page.contentLeft - gutter - width)
        : side.left
      const { height } = measureNote(annotation.text, width, fontSize)

      // Line the note up with what it explains; a summary goes near the bottom,
      // where a student would write one.
      const desired = isSummary
        ? Math.max(page.contentBottom - height, edgePad)
        : (annotation.rect!.top ?? 0) - fontSize * 0.4

      let top = Math.min(
        Math.max(desired, edgePad),
        Math.max(edgePad, page.height - height - edgePad),
      )

      // Slide down past anything already there, then try above if that overflows.
      let guard = 0
      while (overlaps(top, height, taken[side.side], noteGap) && guard < 40) {
        const blocker = taken[side.side]
          .filter((t) => top < t.bottom + noteGap && top + height + noteGap > t.top)
          .sort((a, b) => b.bottom - a.bottom)[0]!
        top = blocker.bottom + noteGap
        guard += 1
      }
      if (top + height > page.height - edgePad) continue

      taken[side.side].push({ top, bottom: top + height })

      const arrow =
        isSummary || !annotation.rect
          ? null
          : arrowPath(
              {
                // Leave from the edge of the note nearest the text.
                x:
                  side.side === "right"
                    ? boxLeft + 2 * scale
                    : boxLeft + width - 2 * scale,
                y: top + height / 2,
              },
              {
                x:
                  side.side === "right"
                    ? annotation.rect.left + annotation.rect.width + 4 * scale
                    : annotation.rect.left - 4 * scale,
                y: annotation.rect.top + annotation.rect.height / 2,
              },
              side.side,
            )

      placed.push({
        id: annotation.id,
        kind: annotation.kind,
        text: annotation.text,
        box: { left: boxLeft, top, width },
        height,
        side: side.side,
        arrow,
      })
      done = true
      break
    }

    if (!done) continue
  }

  return placed
}
