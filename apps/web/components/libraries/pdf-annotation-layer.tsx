"use client"

import { NOTE_FONT_SIZE, measureNote, type PlacedNote } from "@/lib/files/pdf-annotation-layout"

/**
 * The assistant's handwriting, over one page.
 *
 * Graphite rather than black, thin strokes, lines that do not sit perfectly
 * level — the target is mechanical pencil on paper, not a UI callout. Anything
 * that reads as chrome (a crisp box, a straight arrow, pure #000) breaks the
 * illusion that someone sat with the page and worked through it.
 *
 * Everything here is derived from the placement, which is computed elsewhere and
 * unit-tested; this file only draws.
 */

const GRAPHITE = "#3f3f46"

/**
 * Set inline rather than through a utility class: the font is the whole visual
 * premise of the feature, and a purged or mis-ordered class would silently fall
 * back to the UI sans-serif, which reads as a caption instead of handwriting.
 */
const HAND = {
  fontFamily: 'var(--font-caveat), "Segoe Print", "Bradley Hand", cursive',
  fontWeight: 600,
  letterSpacing: "0.01em",
} as const

/** Small marks that say what kind of note this is, in the same pencil. */
const PREFIX: Partial<Record<PlacedNote["kind"], string>> = {
  important: "★ ",
  warning: "⚠ ",
  connection: "→ ",
}

/**
 * A stable per-note jitter.
 *
 * Handwriting varies, but not between renders — a note that re-slants when the
 * page scrolls looks broken rather than human. Derived from the note's own id
 * and position, so it is fixed for as long as the note exists.
 */
function jitter(seedText: string, index: number): number {
  let h = 0
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) % 9973
  return (((h + index * 137) % 100) / 100 - 0.5) * 2
}

function ArrowStroke({ note }: { note: PlacedNote }) {
  if (!note.arrow || note.arrow.length < 3) return null
  const [from, mid, to] = note.arrow as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ]

  // Head sized off the last segment so it always sits along the direction of
  // travel, however the curve bowed.
  const angle = Math.atan2(to.y - mid.y, to.x - mid.x)
  const head = 9
  const spread = 0.42

  return (
    <g opacity={0.8}>
      <path
        d={`M${from.x},${from.y} Q${mid.x},${mid.y} ${to.x},${to.y}`}
        stroke={GRAPHITE}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={
          `M${to.x},${to.y} L${to.x - head * Math.cos(angle - spread)},${to.y - head * Math.sin(angle - spread)} ` +
          `M${to.x},${to.y} L${to.x - head * Math.cos(angle + spread)},${to.y - head * Math.sin(angle + spread)}`
        }
        stroke={GRAPHITE}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  )
}

/** The hand-drawn frame a student puts round something they want to keep. */
function NoteFrame({ note }: { note: PlacedNote }) {
  const w = note.box.width
  const h = note.height
  const j = (i: number) => jitter(note.id, i) * 2.2
  const d =
    `M${2 + j(1)},${2 + j(2)} L${w - 2 + j(3)},${1 + j(4)} ` +
    `L${w - 1 + j(5)},${h - 2 + j(6)} L${3 + j(7)},${h - 1 + j(8)} Z`
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={w}
      height={h}
      aria-hidden
    >
      <path d={d} stroke={GRAPHITE} strokeWidth={1.3} fill="none" opacity={0.6} />
    </svg>
  )
}

export function PdfAnnotationLayer({
  notes,
  width,
  height,
  fontSize = NOTE_FONT_SIZE,
  onSelect,
}: {
  notes: PlacedNote[]
  width: number
  height: number
  /** Matches the size the placement was computed at, so text fills its box. */
  fontSize?: number
  onSelect?: (id: string) => void
}) {
  if (notes.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 flex justify-center py-1.5"
      data-pdf-annotation-layer
    >
      {/* Clipped to the sheet: a stroke that runs past the page edge reads as a
          rendering fault, and nothing drawn outside it could be pointing at
          anything anyway. */}
      {/* The parent is `flex justify-center`, so a box wider than the sheet is
          already centred and the borrowed gutter falls evenly either side.
          Nudging it as well shifted the whole layer by two full gutters, which
          put the notes off the left edge of the viewer and stretched every
          arrow across the page. */}
      <div className="relative overflow-hidden" style={{ width, height }}>
        <svg className="absolute inset-0" width={width} height={height} aria-hidden>
          {notes.map((note) => (
            <ArrowStroke key={`a-${note.id}`} note={note} />
          ))}
        </svg>

        {notes.map((note) => {
          const { lines } = measureNote(note.text, note.box.width, fontSize)
          const framed = note.kind === "summary" || note.kind === "important"
          return (
            <div
              key={note.id}
              className="absolute overflow-hidden"
              // Clipped as well as measured: the estimate decides where the
              // note sits, and a line that outgrows it must be cut rather than
              // allowed to run across the words the note is explaining.
              style={{ left: note.box.left, top: note.box.top, width: note.box.width }}
            >
              {framed ? <NoteFrame note={note} /> : null}
              <button
                type="button"
                onClick={onSelect ? () => onSelect(note.id) : undefined}
                className={
                  "pointer-events-auto block w-full cursor-pointer bg-transparent px-1.5 py-1 text-left " +
                  "transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-1 " +
                  "focus-visible:ring-[#ff4f12] focus-visible:ring-offset-1"
                }
                style={{ color: GRAPHITE, opacity: 0.86 }}
                title="Ask about this note"
              >
                {lines.map((line, i) => (
                  <span
                    key={i}
                    className="block truncate"
                    style={{
                      ...HAND,
                      fontSize,
                      lineHeight: 1.28,
                      // Each line sits a touch differently, as written lines do.
                      transform: `rotate(${jitter(note.id, i) * 0.5}deg) translateX(${jitter(note.id, i + 7) * 1.4}px)`,
                      transformOrigin: "left center",
                    }}
                  >
                    {i === 0 ? (PREFIX[note.kind] ?? "") : ""}
                    {line}
                  </span>
                ))}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
