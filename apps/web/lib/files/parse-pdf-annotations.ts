/**
 * Reading the assistant's teaching notes out of its reply.
 *
 * Same contract as the marks: the model names the text a note is about, never a
 * coordinate. `[note:important:"target phrase":"CO₂ is fixed here!"]` says what
 * to write and what it explains; where it lands is worked out from the page.
 */

import type { PdfNoteKind, PdfPageAnnotation } from "@/lib/files/pdf-annotation-layout"

const KIND_ALIASES: Record<string, PdfNoteKind> = {
  note: "note",
  arrow_note: "note",
  arrow: "note",
  explain: "note",
  important: "important",
  key: "important",
  keyidea: "important",
  star: "important",
  warning: "warning",
  warn: "warning",
  careful: "warning",
  definition: "definition",
  define: "definition",
  def: "definition",
  connection: "connection",
  connect: "connection",
  link: "connection",
  summary: "summary",
  recap: "summary",
}

const KIND_NAMES = Object.keys(KIND_ALIASES).join("|")

/**
 * `[note:<kind>:"target":"text"]` — and `[note:summary:"":"text"]` for a note
 * about the page as a whole. Quotes may be single or double; a model reaches
 * for both.
 */
const NOTE_TAG = new RegExp(
  `\\[note:(${KIND_NAMES}):\\s*(?:"([^"]*)"|'([^']*)')\\s*:\\s*(?:"([^"]*)"|'([^']*)')\\s*\\]`,
  "gi",
)

/** Tolerates the kind being left out entirely: `[note:"target":"text"]`. */
const NOTE_TAG_NO_KIND = new RegExp(
  `\\[note:\\s*(?:"([^"]*)"|'([^']*)')\\s*:\\s*(?:"([^"]*)"|'([^']*)')\\s*\\]`,
  "gi",
)

export const ALL_NOTE_TAGS = new RegExp(
  `${NOTE_TAG.source}|${NOTE_TAG_NO_KIND.source}`,
  "gi",
)

export function normalizeNoteKind(value: string | null | undefined): PdfNoteKind {
  return KIND_ALIASES[(value ?? "").trim().toLowerCase()] ?? "note"
}

/** Notes long enough to be a paragraph stop reading as handwriting. */
const MAX_NOTE_CHARS = 160

export function parseAssistantAnnotations(
  text: string,
  options: { page: number; limit?: number },
): PdfPageAnnotation[] {
  const { page, limit = 8 } = options
  if (!Number.isFinite(page) || page < 1) return []

  const out: PdfPageAnnotation[] = []
  const seen = new Set<string>()

  const push = (kind: PdfNoteKind, target: string, body: string) => {
    const noteText = body.trim().replace(/\s+/g, " ").slice(0, MAX_NOTE_CHARS)
    if (!noteText) return
    const key = `${kind}:${target.trim().toLowerCase()}:${noteText.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: `${page}-${out.length}-${key.length}`,
      page,
      kind,
      text: noteText,
      target: target.trim(),
    })
  }

  let m: RegExpExecArray | null

  NOTE_TAG.lastIndex = 0
  while ((m = NOTE_TAG.exec(text)) !== null) {
    push(normalizeNoteKind(m[1]), m[2] ?? m[3] ?? "", m[4] ?? m[5] ?? "")
  }

  // Only consulted for tags the kinded pattern did not already claim.
  NOTE_TAG_NO_KIND.lastIndex = 0
  while ((m = NOTE_TAG_NO_KIND.exec(text)) !== null) {
    const target = m[1] ?? m[2] ?? ""
    if (KIND_ALIASES[target.trim().toLowerCase()]) continue
    push("note", target, m[3] ?? m[4] ?? "")
  }

  return out.slice(0, limit)
}

export function stripNoteTags(text: string): string {
  return text.replace(ALL_NOTE_TAGS, "")
}
