/**
 * Rasterising one annotated page for export.
 *
 * Self-contained on purpose: it opens its own copy of the document rather than
 * reaching into the viewer's render loop. Export happens once, on a click, and
 * an export path tangled into the scroll-and-zoom machinery would be a standing
 * risk to the thing the student actually uses.
 *
 * The marks and notes are drawn here in Canvas2D, mirroring the SVG layer. That
 * duplication is deliberate and narrow — both sides consume the same placement
 * from `layoutPageAnnotations`, so what moves is only how a stroke is painted,
 * not where it goes.
 */

import type { PDFDocumentProxy } from "pdfjs-dist"

import {
  NOTE_FONT_SIZE,
  layoutPageAnnotations,
  measureNote,
  type PdfPageAnnotation,
  type PlacedNote,
} from "@/lib/files/pdf-annotation-layout"
import type { PdfAnnotationStyle } from "@/lib/files/pdf-annotation-style"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"
import {
  findHighlightRectsOnPage,
  measurePageGeometry,
} from "@/lib/files/pdf-page-text-search"
import type { ExportPageImage } from "@/lib/files/pdf-annotated-export"

const ACCENT = "#ff4f12"
const GRAPHITE = "#3f3f46"

/** Wide enough that the export is worth keeping, small enough to encode fast. */
const EXPORT_WIDTH = 1400

function drawMark(
  ctx: CanvasRenderingContext2D,
  rect: { left: number; top: number; width: number; height: number },
  style: PdfAnnotationStyle,
) {
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.fillStyle = ACCENT
  ctx.lineWidth = Math.max(1.5, rect.height * 0.1)
  ctx.lineCap = "round"

  if (style === "highlight") {
    ctx.globalAlpha = 0.3
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height)
  } else if (style === "underline" || style === "strike") {
    const y = rect.top + rect.height * (style === "underline" ? 0.94 : 0.55)
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(rect.left, y)
    ctx.quadraticCurveTo(rect.left + rect.width / 2, y + ctx.lineWidth, rect.left + rect.width, y)
    ctx.stroke()
  } else if (style === "box") {
    ctx.globalAlpha = 0.8
    ctx.strokeRect(rect.left - 3, rect.top - 2, rect.width + 6, rect.height + 4)
  } else {
    // circle: an open loop that overshoots, same as on screen.
    ctx.globalAlpha = 0.85
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const rx = rect.width / 2 + Math.max(8, rect.height * 0.55)
    const ry = rect.height / 2 + Math.max(5, rect.height * 0.4)
    ctx.beginPath()
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2 * 1.08 - Math.PI / 2
      const x = cx + rx * Math.cos(t)
      const y = cy + ry * Math.sin(t)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawNote(ctx: CanvasRenderingContext2D, note: PlacedNote, fontSize: number) {
  ctx.save()
  ctx.strokeStyle = GRAPHITE
  ctx.fillStyle = GRAPHITE
  ctx.globalAlpha = 0.86
  ctx.lineWidth = Math.max(1.2, fontSize * 0.1)
  ctx.lineCap = "round"

  if (note.arrow && note.arrow.length >= 3) {
    const [from, mid, to] = note.arrow
    ctx.beginPath()
    ctx.moveTo(from!.x, from!.y)
    ctx.quadraticCurveTo(mid!.x, mid!.y, to!.x, to!.y)
    ctx.stroke()

    const angle = Math.atan2(to!.y - mid!.y, to!.x - mid!.x)
    const head = fontSize * 0.6
    ctx.beginPath()
    ctx.moveTo(to!.x, to!.y)
    ctx.lineTo(to!.x - head * Math.cos(angle - 0.42), to!.y - head * Math.sin(angle - 0.42))
    ctx.moveTo(to!.x, to!.y)
    ctx.lineTo(to!.x - head * Math.cos(angle + 0.42), to!.y - head * Math.sin(angle + 0.42))
    ctx.stroke()
  }

  const { lines } = measureNote(note.text, note.box.width, fontSize)
  ctx.font = `600 ${fontSize}px Caveat, "Segoe Print", cursive`
  ctx.textBaseline = "top"
  lines.forEach((line, i) => {
    ctx.fillText(line, note.box.left + fontSize * 0.1, note.box.top + i * fontSize * 1.28)
  })
  ctx.restore()
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
  )
  if (!blob) throw new Error("Could not encode the page")
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Render the given pages with their marks and notes burned in.
 *
 * Pages are processed one at a time and the canvas is reused, because a long
 * document rendered all at once is a straightforward way to exhaust memory on a
 * modest machine.
 */
export async function renderAnnotatedPages(
  pdf: PDFDocumentProxy,
  input: {
    pages: number[]
    notes: PdfPageAnnotation[]
    marks: PdfHighlightTarget[]
  },
): Promise<ExportPageImage[]> {
  const out: ExportPageImage[] = []
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is unavailable")

  for (const pageNumber of input.pages) {
    if (pageNumber < 1 || pageNumber > pdf.numPages) continue
    const page = await pdf.getPage(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      const scale = EXPORT_WIDTH / base.width
      const viewport = page.getViewport({ scale })

      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise

      for (const mark of input.marks.filter((m) => m.page === pageNumber)) {
        const rects = await findHighlightRectsOnPage(
          pdf,
          pageNumber,
          mark.quote,
          viewport.width,
          mark.kind === "heading" ? "heading" : "default",
        )
        for (const rect of rects) drawMark(ctx, rect, mark.style ?? "highlight")
      }

      const pageNotes = input.notes.filter((n) => n.page === pageNumber)
      if (pageNotes.length > 0) {
        const geometry = await measurePageGeometry(pdf, pageNumber, viewport.width)
        if (geometry) {
          const withRects = []
          for (const note of pageNotes) {
            const rects = note.target
              ? await findHighlightRectsOnPage(pdf, pageNumber, note.target, viewport.width)
              : []
            withRects.push({ ...note, rect: rects[0] ?? null })
          }
          const fontSize = NOTE_FONT_SIZE * geometry.scale
          for (const placed of layoutPageAnnotations(withRects, geometry, fontSize)) {
            drawNote(ctx, placed, fontSize)
          }
        }
      }

      out.push({
        jpeg: await canvasToJpeg(canvas),
        width: canvas.width,
        height: canvas.height,
      })
    } finally {
      page.cleanup()
    }
  }

  return out
}
