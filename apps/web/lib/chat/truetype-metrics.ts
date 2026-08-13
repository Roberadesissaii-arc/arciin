/**
 * The few numbers a PDF needs about an embedded TrueType font.
 *
 * A PDF does not read the font to lay out text — it trusts a Widths array the
 * document supplies. Embed the file without one and every glyph is drawn at a
 * default width, so the line either bunches up or crawls apart. That is why this
 * exists: not to render anything, only to read each character's advance out of
 * the font so the writer can declare it truthfully.
 *
 * Enough of the format to answer that and no more — the table directory, `head`
 * for the design grid, `hhea` and `hmtx` for advances, and the `cmap` subtable
 * that maps a character to a glyph.
 */

export type TrueTypeMetrics = {
  unitsPerEm: number
  /** Advance width per character code, already scaled to PDF's 1000-unit em. */
  widths: Map<number, number>
  ascent: number
  descent: number
  /** Bounding box in 1000-unit space, for the font descriptor. */
  bbox: [number, number, number, number]
}

function tag(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}

/**
 * Read the advance widths and vertical metrics.
 *
 * Returns null rather than throwing on anything unexpected: a cover or an export
 * is not worth failing over a font quirk, and the caller falls back to a
 * built-in face.
 */
export function readTrueTypeMetrics(font: Uint8Array): TrueTypeMetrics | null {
  try {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
    const numTables = view.getUint16(4)
    const tables = new Map<string, { offset: number; length: number }>()
    for (let i = 0; i < numTables; i++) {
      const at = 12 + i * 16
      tables.set(tag(view, at), { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) })
    }

    const head = tables.get("head")
    const hhea = tables.get("hhea")
    const hmtx = tables.get("hmtx")
    const cmap = tables.get("cmap")
    if (!head || !hhea || !hmtx || !cmap) return null

    const unitsPerEm = view.getUint16(head.offset + 18) || 1000
    const toPdf = (value: number) => Math.round((value * 1000) / unitsPerEm)

    const bbox: [number, number, number, number] = [
      toPdf(view.getInt16(head.offset + 36)),
      toPdf(view.getInt16(head.offset + 38)),
      toPdf(view.getInt16(head.offset + 40)),
      toPdf(view.getInt16(head.offset + 42)),
    ]
    const ascent = toPdf(view.getInt16(hhea.offset + 4))
    const descent = toPdf(view.getInt16(hhea.offset + 6))
    const numberOfHMetrics = view.getUint16(hhea.offset + 34)
    if (numberOfHMetrics === 0) return null

    /** Advance for a glyph. Past the last full metric the width is repeated. */
    const advanceOf = (glyph: number): number => {
      const index = Math.min(glyph, numberOfHMetrics - 1)
      const at = hmtx.offset + index * 4
      if (at + 2 > font.byteLength) return 0
      return toPdf(view.getUint16(at))
    }

    const glyphFor = buildCharToGlyph(view, cmap.offset)
    if (!glyphFor) return null

    // Latin-1 is the range WinAnsiEncoding addresses, which is what the writer
    // declares; anything outside it is transliterated before it gets here.
    const widths = new Map<number, number>()
    for (let code = 32; code <= 255; code++) {
      const glyph = glyphFor(code)
      widths.set(code, glyph > 0 ? advanceOf(glyph) : 0)
    }

    return { unitsPerEm, widths, ascent, descent, bbox }
  } catch {
    return null
  }
}

/**
 * Character code to glyph id, via the format 4 subtable.
 *
 * Format 4 is the one every text font ships for the Basic Multilingual Plane;
 * a font without it is not one this writer can lay out honestly, so the caller
 * falls back rather than guessing.
 */
function buildCharToGlyph(view: DataView, cmapOffset: number): ((code: number) => number) | null {
  const numTables = view.getUint16(cmapOffset + 2)
  let subtable = -1
  for (let i = 0; i < numTables; i++) {
    const at = cmapOffset + 4 + i * 8
    const platform = view.getUint16(at)
    const encoding = view.getUint16(at + 2)
    const offset = view.getUint32(at + 4)
    // Windows Unicode BMP, or Unicode platform — both are format 4 in practice.
    if ((platform === 3 && encoding === 1) || platform === 0) {
      subtable = cmapOffset + offset
      break
    }
  }
  if (subtable < 0 || view.getUint16(subtable) !== 4) return null

  const segCountX2 = view.getUint16(subtable + 6)
  const segCount = segCountX2 / 2
  const endAt = subtable + 14
  const startAt = endAt + segCountX2 + 2
  const deltaAt = startAt + segCountX2
  const rangeAt = deltaAt + segCountX2

  return (code: number): number => {
    for (let seg = 0; seg < segCount; seg++) {
      const end = view.getUint16(endAt + seg * 2)
      if (code > end) continue
      const start = view.getUint16(startAt + seg * 2)
      if (code < start) return 0
      const delta = view.getInt16(deltaAt + seg * 2)
      const rangeOffset = view.getUint16(rangeAt + seg * 2)
      if (rangeOffset === 0) return (code + delta) & 0xffff
      const glyphAt = rangeAt + seg * 2 + rangeOffset + (code - start) * 2
      if (glyphAt + 1 >= view.byteLength) return 0
      const glyph = view.getUint16(glyphAt)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }
}
