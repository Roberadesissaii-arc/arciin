/**
 * Export Canvas markdown drafts to Markdown / Word-friendly HTML / simple PDF.
 *
 * Maths is handled per format, because the formats differ in what they can do:
 *
 *   - `.md` keeps the LaTeX exactly as written. That *is* the source, and any
 *     markdown reader with math support will typeset it.
 *   - `.doc` and `.pdf` get `latexToReadableText`, which turns
 *     `\frac{1 + \sqrt{5}}{2}` into `(1 + sqrt(5))/2`. Lossy, but readable —
 *     and far better than the raw backslashes these exports used to print.
 *
 * The PDF writer here emits PDF operators by hand with the built-in Times
 * fonts, which are Latin-1 only: no Greek, no fraction bars, no glyph metrics
 * for anything else. Real typesetting would mean embedding a font and a layout
 * engine, so the readable-text fallback is the honest ceiling for now.
 */

import { extractBlockMath, latexToReadableText, splitInlineMath } from "@arciin/shared"

export type CanvasExportFormat = "md" | "pdf" | "doc"

/**
 * Replace every LaTeX span with readable text, leaving prose untouched.
 * Applied to the document before either non-markdown exporter sees it.
 */
export function flattenMathForExport(markdown: string): string {
  const { text, blocks } = extractBlockMath(markdown)

  const withBlocks = text
    .split("\n")
    .map((line) => {
      const index = readMathBlockIndex(line)
      if (index === null || blocks[index] === undefined) return line
      return latexToReadableText(blocks[index]!)
    })
    .join("\n")

  return withBlocks
    .split("\n")
    .map((line) =>
      splitInlineMath(line)
        .map((segment) =>
          segment.type === "math" ? latexToReadableText(segment.value) : segment.value,
        )
        .join(""),
    )
    .join("\n")
}

function readMathBlockIndex(line: string): number | null {
  const match = /^\u0000arciin-math-(\d+)\u0000$/.exec(line.trim())
  return match ? Number.parseInt(match[1]!, 10) : null
}

export function canvasExportLabel(format: CanvasExportFormat): string {
  switch (format) {
    case "md":
      return "Markdown (.md)"
    case "pdf":
      return "PDF (.pdf)"
    case "doc":
      return "Word (.doc)"
  }
}

export function canvasExportExtension(format: CanvasExportFormat): string {
  return format
}

export function canvasExportMime(format: CanvasExportFormat): string {
  switch (format) {
    case "md":
      return "text/markdown;charset=utf-8"
    case "pdf":
      return "application/pdf"
    case "doc":
      return "application/msword"
  }
}

/** Light markdown → HTML for Word and PDF layout. */
export function markdownToSimpleHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let inList = false

  const flushList = () => {
    if (inList) {
      out.push("</ul>")
      inList = false
    }
  }

  // Tables must survive the export or a medication schedule saves as a run of
  // paragraphs beginning with a pipe — which is what Canvas itself used to do.
  const tableRows: string[] = []
  const isSeparator = (line: string) => /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line)
  const flushTable = () => {
    if (tableRows.length === 0) return
    const rows = tableRows.splice(0)
    const cells = (line: string) =>
      line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
    const hasHeader = rows.length > 1 && isSeparator(rows[1]!)
    const head = hasHeader
      ? `<thead><tr>${cells(rows[0]!).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`
      : ""
    const bodyRows = rows.filter((line, i) => !(hasHeader && i < 2) && !isSeparator(line))
    const body = bodyRows
      .map((line) => `<tr>${cells(line).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
      .join("")
    out.push(`<table>${head}<tbody>${body}</tbody></table>`)
  }

  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList()
      tableRows.push(line)
      continue
    }
    flushTable()
    if (!line.trim()) {
      flushList()
      continue
    }
    if (/^###\s+/.test(line)) {
      flushList()
      out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`)
      continue
    }
    if (/^##\s+/.test(line)) {
      flushList()
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`)
      continue
    }
    if (/^#\s+/.test(line)) {
      flushList()
      out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`)
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>")
        inList = true
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`)
      continue
    }
    flushList()
    out.push(`<p>${inline(line.trim())}</p>`)
  }
  flushTable()
  flushList()
  return out.join("\n")
}

/**
 * Word has no Caveat, so the handwriting stack names faces that ship with the
 * operating systems this runs on and falls back to generic cursive. The draft
 * opens in a hand on any machine rather than silently reverting to serif.
 */
function wrapHtmlDocument(title: string, bodyHtml: string, handwriting = false): string {
  const safeTitle = title.replace(/</g, "").replace(/>/g, "")
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { margin: 1in; }
  body {
    font-family: ${
      handwriting
        ? '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive'
        : '"Georgia", "Times New Roman", serif'
    };
    font-size: 12pt;
    line-height: 1.65;
    color: #111;
    max-width: 7in;
    margin: 0 auto;
    padding: 0.5in 0.75in 1in;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 0.6em; font-weight: 700; }
  h2 { font-size: 14pt; margin: 1.4em 0 0.5em; font-weight: 700; }
  h3 { font-size: 12.5pt; margin: 1.1em 0 0.4em; font-weight: 700; }
  p { margin: 0 0 0.85em; text-align: justify; }
  ul { margin: 0 0 0.85em 1.25em; padding: 0; }
  li { margin: 0.25em 0; }
  code { font-family: ui-monospace, monospace; font-size: 0.92em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em; }
  th, td { border: 1px solid #d4d4d8; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

/** Escape PDF string literal (basic). */
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

/** Built-in PDF fonts (Times = academic look). Keep text ASCII-safe. */
function toPdfLatin1(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7•]/g, "-")
    .replace(/\u00A0/g, " ")
    // Everything else is dropped, including Latin-1. The page stream is encoded
    // with TextEncoder (UTF-8) into a Times font carrying no /Encoding entry,
    // so a byte like 0xB2 is not "²" — it is StandardEncoding's dagger, and a
    // two-byte UTF-8 sequence renders as two wrong glyphs. Keeping high bytes
    // here produced exactly that mojibake.
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
}

function stripInlineMd(s: string): string {
  return toPdfLatin1(
    s
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim(),
  )
}

type PdfRun = {
  text: string
  /** Font key in page resources */
  font: "F1" | "F2"
  size: number
  /** Space after this line before the next (points) */
  after: number
  /** Left indent from content left margin */
  indent: number
  /** Center on page (title) */
  center?: boolean
}

/** Approx average glyph width as fraction of font size (Times). */
function avgCharWidth(size: number, bold: boolean): number {
  return size * (bold ? 0.52 : 0.48)
}

function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
): string[] {
  const t = text.trim()
  if (!t) return [""]
  const cw = avgCharWidth(size, bold)
  const maxChars = Math.max(20, Math.floor(maxWidth / cw))
  const words = t.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length > maxChars && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [""]
}

/**
 * Formatted multi-page PDF from markdown:
 * - 1" margins, Times Roman / Bold
 * - Title, H2/H3 hierarchy, body paragraphs, lists
 * - Paragraph spacing + page numbers
 */
export function markdownToPdfBytes(title: string, markdown: string): Uint8Array {
  const PAGE_W = 612
  const PAGE_H = 792
  const MARGIN_L = 72 // 1 inch
  const MARGIN_R = 72
  const MARGIN_T = 72
  const MARGIN_B = 72
  const contentW = PAGE_W - MARGIN_L - MARGIN_R
  const topY = PAGE_H - MARGIN_T
  const bottomY = MARGIN_B + 28 // leave room for page number

  const BODY = 11
  const H1 = 18
  const H2 = 13
  const H3 = 11.5
  const BODY_LEADING = 16
  const H1_LEADING = 24
  const H2_LEADING = 18
  const H3_LEADING = 16

  const runs: PdfRun[] = []
  const pushRuns = (
    text: string,
    opts: { font: "F1" | "F2"; size: number; after: number; indent?: number; center?: boolean; leading: number },
  ) => {
    const lines = wrapText(text, contentW - (opts.indent ?? 0), opts.size, opts.font === "F2")
    lines.forEach((line, i) => {
      runs.push({
        text: line,
        font: opts.font,
        size: opts.size,
        after: i === lines.length - 1 ? opts.after : opts.leading - opts.size,
        indent: opts.indent ?? 0,
        center: opts.center,
      })
    })
  }

  const md = markdown.replace(/\r\n/g, "\n").trim()
  const rawLines = md.split("\n")
  let sawTitle = false

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li]!.trimEnd()
    const line = raw.trim()
    if (!line) {
      // paragraph break
      if (runs.length) runs[runs.length - 1]!.after = Math.max(runs[runs.length - 1]!.after, 10)
      continue
    }
    // skip fenced code markers for PDF (render content as body)
    if (/^```/.test(line)) continue

    if (/^#\s+/.test(line) && !sawTitle) {
      sawTitle = true
      pushRuns(stripInlineMd(line.replace(/^#\s+/, "")), {
        font: "F2",
        size: H1,
        leading: H1_LEADING,
        after: 18,
        center: true,
      })
      continue
    }
    if (/^#\s+/.test(line)) {
      pushRuns(stripInlineMd(line.replace(/^#\s+/, "")), {
        font: "F2",
        size: H1 - 2,
        leading: H1_LEADING,
        after: 14,
      })
      continue
    }
    if (/^##\s+/.test(line)) {
      pushRuns(stripInlineMd(line.replace(/^##\s+/, "")), {
        font: "F2",
        size: H2,
        leading: H2_LEADING,
        after: 10,
      })
      continue
    }
    if (/^###\s+/.test(line)) {
      pushRuns(stripInlineMd(line.replace(/^#{3,6}\s+/, "")), {
        font: "F2",
        size: H3,
        leading: H3_LEADING,
        after: 8,
      })
      continue
    }
    if (/^[-*+]\s+/.test(line)) {
      pushRuns(`-  ${stripInlineMd(line.replace(/^[-*+]\s+/, ""))}`, {
        font: "F1",
        size: BODY,
        leading: BODY_LEADING,
        after: 4,
        indent: 18,
      })
      continue
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const m = line.match(/^(\d+[.)])\s+(.+)$/)
      const label = m?.[1] ?? "1."
      const rest = stripInlineMd(m?.[2] ?? line)
      pushRuns(`${label}  ${rest}`, {
        font: "F1",
        size: BODY,
        leading: BODY_LEADING,
        after: 5,
        indent: 18,
      })
      continue
    }
    // body paragraph
    pushRuns(stripInlineMd(line), {
      font: "F1",
      size: BODY,
      leading: BODY_LEADING,
      after: 10,
    })
  }

  // Fallback title if markdown had no H1
  if (!sawTitle && title.trim()) {
    runs.unshift({
      text: toPdfLatin1(title.trim()),
      font: "F2",
      size: H1,
      after: 18,
      indent: 0,
      center: true,
    })
  }
  if (!runs.length) {
    runs.push({ text: toPdfLatin1(title || "Document"), font: "F2", size: H1, after: 12, indent: 0, center: true })
  }

  // Paginate by vertical position
  type PageRuns = PdfRun[]
  const pages: PageRuns[] = []
  let page: PdfRun[] = []
  let y = topY

  const forceNewPage = () => {
    if (page.length) pages.push(page)
    page = []
    y = topY
  }

  for (const run of runs) {
    const lineHeight = run.size + Math.max(2, run.after > 0 ? 2 : 0)
    if (y - lineHeight < bottomY) forceNewPage()
    page.push(run)
    y -= run.size + run.after
  }
  if (page.length) pages.push(page)
  if (!pages.length) pages.push([{ text: "Document", font: "F2", size: H1, after: 0, indent: 0 }])

  // Build PDF objects
  type PdfObj = { id: number; body: string }
  const objs: PdfObj[] = []
  const pushObj = (body: string) => {
    const id = objs.length + 1
    objs.push({ id, body })
    return id
  }

  const catalogId = pushObj("")
  const pagesId = pushObj("")
  const fontRegularId = pushObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>")
  const fontBoldId = pushObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>")

  const pageIds: number[] = []

  pages.forEach((pageRuns, pageIndex) => {
    const ops: string[] = []
    let curY = topY

    for (const run of pageRuns) {
      const text = pdfEscape(run.text)
      const font = run.font === "F2" ? "F2" : "F1"
      let x = MARGIN_L + run.indent
      if (run.center && run.text) {
        const w = run.text.length * avgCharWidth(run.size, run.font === "F2")
        x = Math.max(MARGIN_L, (PAGE_W - w) / 2)
      }
      // Tm: a b c d e f — position baseline
      ops.push("BT")
      ops.push(`/${font} ${run.size.toFixed(1)} Tf`)
      ops.push(`1 0 0 1 ${x.toFixed(2)} ${curY.toFixed(2)} Tm`)
      ops.push(`(${text}) Tj`)
      ops.push("ET")
      curY -= run.size + run.after
    }

    // Page number centered in bottom margin
    const pageLabel = `Page ${pageIndex + 1} of ${pages.length}`
    const pnW = pageLabel.length * avgCharWidth(9, false)
    const pnX = (PAGE_W - pnW) / 2
    ops.push("BT")
    ops.push(`/F1 9 Tf`)
    ops.push(`1 0 0 1 ${pnX.toFixed(2)} ${(MARGIN_B - 8).toFixed(2)} Tm`)
    ops.push(`(${pdfEscape(pageLabel)}) Tj`)
    ops.push("ET")

    const stream = ops.join("\n")
    const streamBytes = new TextEncoder().encode(stream)
    const contentId = pushObj(
      `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`,
    )
    const pageId = pushObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Contents ${contentId} 0 R ` +
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`,
    )
    pageIds.push(pageId)
  })

  objs[catalogId - 1]!.body = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objs[pagesId - 1]!.body =
    `<< /Type /Pages /Kids [ ${pageIds.map((id) => `${id} 0 R`).join(" ")} ] /Count ${pageIds.length} >>`

  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let size = 0
  const append = (s: string | Uint8Array) => {
    const part = typeof s === "string" ? encoder.encode(s) : s
    chunks.push(part)
    size += part.length
  }

  append("%PDF-1.4\n")
  const offsets: number[] = [0]
  for (const obj of objs) {
    offsets[obj.id] = size
    append(`${obj.id} 0 obj\n`)
    append(obj.body)
    append("\nendobj\n")
  }
  const xrefPos = size
  append(`xref\n0 ${objs.length + 1}\n`)
  append("0000000000 65535 f \n")
  for (let i = 1; i <= objs.length; i++) {
    append(`${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`)
  }
  append(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\n`)
  append(`startxref\n${xrefPos}\n%%EOF\n`)

  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

export function buildCanvasExportFile(
  title: string,
  markdown: string,
  format: CanvasExportFormat,
  options: { handwriting?: boolean } = {},
): File {
  const safeBase =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Untitled draft"

  const body = markdown.trim().startsWith("#")
    ? markdown.trim()
    : `# ${title.trim() || "Untitled draft"}\n\n${markdown.trim()}`

  if (format === "md") {
    return new File([body], `${safeBase}.md`, {
      type: canvasExportMime("md"),
      lastModified: Date.now(),
    })
  }

  // Markdown keeps its LaTeX; the other two cannot typeset it, so flatten.
  const exportBody = flattenMathForExport(body)

  if (format === "doc") {
    const html = wrapHtmlDocument(
      title,
      markdownToSimpleHtml(exportBody),
      options.handwriting === true,
    )
    return new File([html], `${safeBase}.doc`, {
      type: canvasExportMime("doc"),
      lastModified: Date.now(),
    })
  }

  // pdf — copy into a fresh ArrayBuffer so File/Blob gets a real buffer
  const bytes = markdownToPdfBytes(title, exportBody)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new File([copy], `${safeBase}.pdf`, {
    type: canvasExportMime("pdf"),
    lastModified: Date.now(),
  })
}
