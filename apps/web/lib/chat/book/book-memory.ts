/**
 * What the book has established, kept small enough to resend every turn.
 *
 * The manuscript is the wrong thing to send back. By chapter twelve it is fifty
 * thousand words: more expensive than the chapter being written, and long
 * enough that the outline — the part that actually steers — is buried in the
 * middle where models attend to it least.
 *
 * So the book keeps notes on itself. After each chapter the model reports, in
 * tags stripped before anything is appended, what that chapter established and
 * what a later chapter must not contradict. Those notes cost nothing extra:
 * they ride on the chapter's own response rather than a second call.
 *
 * Deliberately outside the manuscript. A reader exporting their book should not
 * find a continuity table in chapter twelve.
 */

import { countWords } from "./book-parser"
import type { BookMemory, ChapterSummary, MemoryEntity, StoryThread } from "./types"
import { emptyBookMemory } from "./types"

/** Summaries carried in full; older ones are compressed to their first line. */
const RECENT_SUMMARIES = 4
/** Beyond this, the oldest entities are dropped rather than growing forever. */
const MAX_ENTITIES = 24
/** Characters of manuscript that travel with a continuation. */
export const TAIL_CHARS = 2400

/* ----------------------------------------------------------------- reporting */

/**
 * What the model is asked to report about the chapter it just wrote.
 *
 * Appended to the chapter request, and every tag is stripped from the response
 * before it reaches the manuscript.
 */
export function buildMemoryReportInstruction(): string {
  return [
    "",
    "After the chapter, on their own lines at the very end, report what it established.",
    "These lines are removed before the chapter is saved, so write nothing else on them:",
    '[chapter-summary:"two or three sentences on what happened or was argued"]',
    '[carry:"Name or term — what is now true about it"]  (up to four, only if new)',
    '[thread-open:"short id — the question this chapter leaves unanswered"]  (if any)',
    '[thread-resolved:"short id"]  (if this chapter closed one)',
    "Report only what a later chapter would need to avoid contradicting.",
  ].join("\n")
}

type MemoryReport = {
  summary: string
  carries: Array<{ name: string; note: string }>
  opened: Array<{ id: string; description: string }>
  resolved: string[]
}

/**
 * Pull every value for one tag out of a response.
 *
 * Two shapes accepted, for the same reason the stripper has two passes: the
 * well-formed quoted value, and a whole line whose value contains quotation
 * marks of its own. A malformed tag costs one note, never the chapter — the
 * caller falls back to the chapter's own opening sentences.
 */
function tagValues(text: string, tag: string): string[] {
  const out: string[] = []
  const quoted = new RegExp(`\\[${tag}\\s*:\\s*"([^"]*)"\\s*\\]`, "gi")
  for (const m of text.matchAll(quoted)) {
    const value = (m[1] ?? "").trim()
    if (value) out.push(value)
  }
  if (out.length > 0) return out

  const loose = new RegExp(`^[ \\t]*\\[${tag}\\s*:\\s*(.*?)\\s*\\][ \\t]*$`, "gim")
  for (const m of text.matchAll(loose)) {
    const value = (m[1] ?? "").trim().replace(/^"|"$/g, "").trim()
    if (value) out.push(value)
  }
  return out
}

/** Split `Name — note` on any dash, falling back to the whole string. */
function splitLabelled(value: string): { name: string; note: string } {
  const m = value.match(/^(.{1,60}?)\s*[—–:-]\s*(.+)$/)
  if (!m) return { name: value.slice(0, 60), note: value }
  return { name: m[1]!.trim(), note: m[2]!.trim() }
}

export function parseMemoryReport(raw: string): MemoryReport {
  return {
    summary: tagValues(raw, "chapter-summary")[0] ?? "",
    carries: tagValues(raw, "carry").slice(0, 4).map(splitLabelled),
    opened: tagValues(raw, "thread-open").map((v) => {
      const { name, note } = splitLabelled(v)
      return { id: name.toLowerCase(), description: note }
    }),
    resolved: tagValues(raw, "thread-resolved").map((v) => splitLabelled(v).name.toLowerCase()),
  }
}

/* ------------------------------------------------------------------ updating */

function mergeEntities(existing: MemoryEntity[], incoming: MemoryEntity[]): MemoryEntity[] {
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]))
  for (const entity of incoming) {
    const key = entity.name.toLowerCase()
    const prior = byName.get(key)
    // A later note supersedes an earlier one: the point is what is true now,
    // not a log of everything ever said about the name.
    byName.set(key, prior ? { ...entity, note: entity.note || prior.note } : entity)
  }
  return [...byName.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, MAX_ENTITIES)
}

/**
 * Fold one chapter's report into the book's memory.
 *
 * Pure: takes memory, returns memory. That is what lets the orchestrator write
 * it only after the append has succeeded, so a rejected chapter leaves no trace.
 */
export function applyChapterToMemory(input: {
  memory: BookMemory
  chapter: number
  title: string
  text: string
  raw: string
}): BookMemory {
  const report = parseMemoryReport(input.raw)
  const memory: BookMemory = {
    ...emptyBookMemory(),
    ...input.memory,
  }

  const summary: ChapterSummary = {
    chapter: input.chapter,
    title: input.title,
    // A model that skipped the tag still gets a usable entry: the opening of
    // its own chapter is a worse summary than one it wrote, but far better
    // than a gap, which would let chapter nine re-tell chapter four.
    summary: report.summary || firstSentences(input.text, 2),
    words: countWords(input.text),
  }

  const carries: MemoryEntity[] = report.carries.map((c) => ({
    name: c.name,
    note: c.note,
    lastSeen: input.chapter,
  }))

  const opened: StoryThread[] = report.opened.map((t) => ({
    id: t.id,
    description: t.description,
    openedIn: input.chapter,
  }))

  const threads = [...memory.threads]
  for (const thread of opened) {
    if (!threads.some((t) => t.id === thread.id)) threads.push(thread)
  }
  for (const id of report.resolved) {
    const found = threads.find((t) => t.id === id && !t.resolvedIn)
    if (found) found.resolvedIn = input.chapter
  }

  return {
    ...memory,
    chapterSummaries: [
      ...memory.chapterSummaries.filter((s) => s.chapter !== input.chapter),
      summary,
    ].sort((a, b) => a.chapter - b.chapter),
    // One bucket in practice: whether a carried note is a character, a place or
    // a defined term is a distinction the prompt does not need, and asking a
    // model to classify them reliably costs more than it returns.
    facts: mergeEntities(memory.facts, carries),
    threads,
  }
}

function firstSentences(text: string, count: number): string {
  const body = text
    .replace(/^#{1,6}[^\n]*\n/, "")
    .replace(/\s+/g, " ")
    .trim()
  const parts = body.split(/(?<=[.!?])\s+/).slice(0, count)
  return parts.join(" ").slice(0, 400)
}

/**
 * Drop memory for chapters that no longer exist.
 *
 * Called when the manuscript is re-parsed and turns out to be shorter than the
 * memory thinks — the reader deleted chapter six by hand. Keeping a summary for
 * a chapter that is gone would have the next prompt reference a scene the book
 * no longer contains.
 */
export function truncateMemory(memory: BookMemory, written: number): BookMemory {
  return {
    ...memory,
    chapterSummaries: memory.chapterSummaries.filter((s) => s.chapter <= written),
    facts: memory.facts.filter((f) => f.lastSeen <= written),
    threads: memory.threads
      .filter((t) => t.openedIn <= written)
      .map((t) => (t.resolvedIn && t.resolvedIn > written ? { ...t, resolvedIn: undefined } : t)),
  }
}

/* ------------------------------------------------------------------ rendering */

/**
 * Memory as prompt text.
 *
 * Recent chapters keep their full summary; older ones are compressed to a
 * clause, because what chapter two needs from chapter one is detail and what
 * chapter twelve needs from chapter one is a reminder that it happened.
 */
export function renderMemoryForPrompt(memory: BookMemory, upTo: number): string {
  const lines: string[] = []
  const summaries = memory.chapterSummaries.filter((s) => s.chapter <= upTo)

  if (summaries.length > 0) {
    const recent = summaries.slice(-RECENT_SUMMARIES)
    const older = summaries.slice(0, Math.max(0, summaries.length - RECENT_SUMMARIES))

    lines.push("WHAT THE BOOK HAS COVERED")
    for (const s of older) {
      lines.push(`  ${s.chapter}. ${s.title}: ${firstSentences(s.summary, 1)}`)
    }
    for (const s of recent) {
      lines.push(`  ${s.chapter}. ${s.title}: ${s.summary}`)
    }
    lines.push("")
  }

  if (memory.facts.length > 0) {
    lines.push("ESTABLISHED — do not contradict these:")
    for (const f of memory.facts) lines.push(`  - ${f.name}: ${f.note}`)
    lines.push("")
  }

  const open = memory.threads.filter((t) => !t.resolvedIn)
  if (open.length > 0) {
    lines.push("STILL OPEN — carry these forward, resolve only when the plan says to:")
    for (const t of open) lines.push(`  - ${t.description} (opened in chapter ${t.openedIn})`)
    lines.push("")
  }

  if (memory.styleNotes.length > 0) {
    lines.push(`VOICE: ${memory.styleNotes.join("; ")}`, "")
  }

  return lines.join("\n").trim()
}

/** The last stretch of manuscript, so the seam between chapters is invisible. */
export function manuscriptTail(manuscript: string, chars = TAIL_CHARS): string {
  return manuscript.trim().slice(-chars)
}
