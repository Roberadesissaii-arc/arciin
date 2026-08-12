/**
 * Exporting the annotated page as a real PDF.
 *
 * There is no PDF library in the project and no appetite for adding one to write
 * a page-tree merger, so this takes the honest route: each page is rendered with
 * its annotation layer drawn on top, and the resulting images are assembled into
 * a new PDF. The output is a picture of the annotated page rather than a text
 * PDF — searchable text is lost, which is a real cost and the reason the
 * original file is never touched and the layer is always still there to
 * regenerate from.
 *
 * JPEG is embedded directly with DCTDecode, so nothing has to be re-encoded.
 */

export type ExportPageImage = {
  /** JPEG bytes, straight from a canvas. */
  jpeg: Uint8Array
  width: number
  height: number
}

function latin1(bytes: string): Uint8Array {
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i) & 0xff
  return out
}

/**
 * Assemble pages into a PDF.
 *
 * Objects are written in order with their byte offsets recorded, because the
 * xref table has to point at exact positions — a PDF whose xref is one byte out
 * will not open in some readers and opens fine in others, which is the worst
 * kind of bug to chase later.
 */
export function buildAnnotatedPdf(pages: ExportPageImage[]): Blob {
  if (pages.length === 0) throw new Error("No pages to export")

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let position = 0

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? latin1(data) : data
    chunks.push(bytes)
    position += bytes.length
  }

  // 1 = catalog, 2 = pages; then three objects per page.
  const objectCount = 2 + pages.length * 3
  const startObject = (index: number) => {
    offsets[index] = position
    push(`${index} 0 obj\n`)
  }

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")

  const pageObjectId = (i: number) => 3 + i * 3
  const contentObjectId = (i: number) => 4 + i * 3
  const imageObjectId = (i: number) => 5 + i * 3

  startObject(1)
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

  startObject(2)
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages
      .map((_, i) => `${pageObjectId(i)} 0 R`)
      .join(" ")}] >>\nendobj\n`,
  )

  pages.forEach((page, i) => {
    const w = Math.max(1, Math.round(page.width))
    const h = Math.max(1, Math.round(page.height))

    startObject(pageObjectId(i))
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imageObjectId(i)} 0 R >> >> ` +
        `/Contents ${contentObjectId(i)} 0 R >>\nendobj\n`,
    )

    // Draw the image at exactly page size.
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`
    startObject(contentObjectId(i))
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)

    startObject(imageObjectId(i))
    push(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${page.jpeg.length} >>\nstream\n`,
    )
    push(page.jpeg)
    push("\nendstream\nendobj\n")
  })

  const xrefPosition = position
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objectCount; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`
  }
  push(xref)
  push(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`,
  )

  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const merged = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    merged.set(chunk, at)
    at += chunk.length
  }
  return new Blob([merged], { type: "application/pdf" })
}

/** Filename for the exported copy, next to the original rather than over it. */
export function annotatedFilename(original: string): string {
  const base = original.replace(/\.pdf$/i, "").trim() || "document"
  return `${base} (annotated).pdf`
}
