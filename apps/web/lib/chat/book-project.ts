/**
 * Writing a book across many turns.
 *
 * A book does not fit in one reply. Ask for one and a model writes a summary of
 * a book — an outline with a paragraph under each heading — because that is what
 * fits in the tokens it has. The only way to get a real one is to write it a
 * chapter at a time and keep going.
 *
 * That needs memory the chat does not have on its own. By chapter six the
 * opening turn has scrolled far up the context, and a model asked to "continue"
 * invents a chapter seven that contradicts chapter two. So the outline, the
 * chapter list and the position in it are held here, on the client, and travel
 * with every continuation. The Canvas holds the prose; this holds the plan.
 *
 * Pure except for the two storage functions, so the parsing can be checked
 * without a browser.
 */

export type BookChapter = {
  /** 1-based, matching the number in the heading. */
  number: number
  title: string
  /** A one-line note from the outline, so a later chapter knows its own remit. */
  summary: string
}

export type BookProject = {
  conversationId: string
  /** The book's own title, taken from the draft once the model has named it. */
  title: string
  /** What the reader asked for, kept verbatim — it sets the voice throughout. */
  brief: string
  chapters: BookChapter[]
  /** How many chapters are actually written in the Canvas draft. */
  written: number
  updatedAt: number
}

const STORAGE_KEY = "arciin:book-projects"

/**
 * Where a book started in a chat that has no id yet.
 *
 * The conversation row is created by the first turn, so `/book` on a fresh chat
 * finishes before there is anything to key the project to. It is parked here and
 * moved by `rekeyBookProject` once the id exists — the same trick the Canvas
 * drafts use, and without it the very first "continue" of every new book found
 * nothing and started a second book.
 */
const NEW_CHAT_KEY = "__new__"
/** Enough for the books in flight; older ones fall off rather than grow forever. */
const MAX_PROJECTS = 12

/**
 * How much of the draft's tail travels with a continuation.
 *
 * The model needs the end of the previous chapter to pick up its thread, not
 * the whole book — sending fifty thousand words back on every turn costs more
 * than the chapter being written and pushes the outline out of attention.
 */
const TAIL_CHARS = 2400

/* ------------------------------------------------------------------ parsing */

/**
 * Read the chapter list out of a draft.
 *
 * Two shapes are accepted because models produce both: a contents list near the
 * top ("1. The Long Silence — why nobody looked"), and the chapter headings
 * themselves. The contents list wins when present, since it describes chapters
 * that have not been written yet, which is the entire point of holding it.
 */
export function parseBookOutline(markdown: string): BookChapter[] {
  const contents = markdown.match(
    /^#{1,3}\s*(?:table\s+of\s+)?contents\s*$([\s\S]*?)(?=^#{1,3}\s|\z)/im,
  )

  if (contents?.[1]) {
    const rows: BookChapter[] = []
    for (const line of contents[1].split("\n")) {
      const row = line.match(
        /^\s*(?:[-*]\s*)?(?:chapter\s*)?(\d+)\s*[.):—–-]\s*(.+)$/i,
      )
      if (!row) continue
      const number = Number(row[1])
      if (!Number.isFinite(number) || number < 1) continue
      // "The Long Silence — why nobody looked" splits into title and remit.
      const rest = (row[2] ?? "").trim().replace(/\s*[|·]\s*/g, " — ")
      const split = rest.match(/^(.+?)\s+[—–]\s+(.+)$/)
      rows.push({
        number,
        title: (split?.[1] ?? rest).trim().replace(/[.*_`]+$/g, "").trim(),
        summary: (split?.[2] ?? "").trim(),
      })
    }
    if (rows.length >= 2) {
      return rows.sort((a, b) => a.number - b.number)
    }
  }

  // Fall back to the written headings, which at least says what exists.
  const headings: BookChapter[] = []
  const re = /^#{1,3}\s*chapter\s+(\d+)\s*[:.—–-]?\s*(.*)$/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const number = Number(m[1])
    if (!Number.isFinite(number)) continue
    headings.push({ number, title: (m[2] ?? "").trim(), summary: "" })
  }
  return headings.sort((a, b) => a.number - b.number)
}

/**
 * How many chapters the draft actually contains.
 *
 * Counted from the headings rather than tracked as a tally, so a chapter the
 * model skipped or merged does not leave the position permanently wrong.
 */
export function countChaptersWritten(markdown: string): number {
  const numbers = new Set<number>()
  const re = /^#{1,3}\s*chapter\s+(\d+)\b/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const n = Number(m[1])
    if (Number.isFinite(n)) numbers.add(n)
  }
  return numbers.size
}

/** The book's title, if it has named itself in a top-level heading. */
export function parseBookTitle(markdown: string, fallback: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)
  const title = h1?.[1]?.trim().replace(/[*_`]/g, "")
  if (!title) return fallback
  if (/^(?:table\s+of\s+)?contents$/i.test(title)) return fallback
  return title.slice(0, 120)
}

/**
 * "continue", and the dozen other ways a reader says it.
 *
 * Deliberately narrow: this turns a plain message into a book turn, so it must
 * not fire on "continue the analysis in section three", which is a different
 * request that happens to start with the same word.
 */
export function isBookContinueRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "")
  if (!t) return false
  if (t.length > 48) return false
  return (
    /^(?:\/book\s+)?(?:continue|carry on|keep going|go on|next|more)$/.test(t) ||
    /^(?:please\s+)?(?:continue|keep)\s+(?:writing|going)$/.test(t) ||
    /^(?:write|do)\s+(?:the\s+)?next\s+chapter$/.test(t) ||
    /^next\s+chapter$/.test(t) ||
    /^(?:continue|keep\s+writing)\s+the\s+book$/.test(t)
  )
}

/* ------------------------------------------------------------------ prompts */

const SHARED_RULES = [
  "Write real prose, not an outline. No bullet summaries standing in for a chapter,",
  "no \"in this chapter we will\", no notes to the reader about what you are doing.",
  "Every claim gets its own sentences: scenes, examples, named specifics, argument.",
  "Do not pad with restatement — a paragraph that only rephrases the one above it",
  "is worse than a shorter chapter.",
].join(" ")

/**
 * The opening turn: front matter, the full plan, and chapter one.
 *
 * The whole outline is demanded up front even though only one chapter gets
 * written, because it is what every later turn steers by. Without it the book
 * is improvised chapter to chapter and starts repeating itself around chapter
 * four.
 */
export function buildBookOpeningPrompt(brief: string): string {
  const topic = brief.trim() || "a subject you judge worth a book, and say why you chose it"

  return [
    `Write a book: ${topic}`,
    "",
    "This is a real book, written over many turns — not an article and not a summary.",
    "In THIS turn produce exactly the following, in this order, and nothing else:",
    "",
    "1. `# <the book's title>` — a real title, not the topic restated.",
    "2. One short paragraph: what this book argues or tells, and who it is for.",
    "3. `## Contents` — the complete chapter list, 8 to 14 chapters, every one",
    "   numbered, in this exact form, one per line:",
    "   `1. Chapter Title — the one thing this chapter does`",
    "   Plan the whole arc now. Later turns follow this list, so a chapter you",
    "   forget here never gets written.",
    "4. `## Chapter 1: <title from the list>` — then chapter one IN FULL.",
    "   1,200 to 2,000 words. This is the chapter itself, not a description of it.",
    "",
    SHARED_RULES,
    "",
    "Stop at the end of chapter 1. Do not begin chapter 2, do not write a closing",
    "note, and do not ask whether to carry on — the reader types \"continue\" for that.",
  ].join("\n")
}

/**
 * A continuation turn: one chapter, with the plan and the tail for context.
 *
 * Only the next chapter is asked for, and only the new text comes back — the
 * Canvas appends it. Asking for the whole book again each turn would re-spend
 * every earlier chapter's tokens and degrade the prose that was already good.
 */
export function buildBookContinuePrompt(
  project: BookProject,
  draft: string,
): string {
  const next = project.written + 1
  const planned = project.chapters.find((c) => c.number === next)
  const remaining = project.chapters.filter((c) => c.number > project.written)

  const tail = draft.trim().slice(-TAIL_CHARS)
  const finished = project.chapters.filter((c) => c.number <= project.written)

  const lines = [
    `Continue the book "${project.title}". Write CHAPTER ${next} and stop.`,
    "",
    `Original brief: ${project.brief}`,
    "",
  ]

  if (finished.length > 0) {
    lines.push(
      `Already written (do not repeat this ground): ${finished
        .map((c) => `${c.number}. ${c.title}`)
        .join("; ")}`,
      "",
    )
  }

  if (planned) {
    lines.push(
      `Chapter ${next} is "${planned.title}"${planned.summary ? ` — ${planned.summary}` : ""}.`,
      "",
    )
  } else {
    lines.push(
      `The outline does not name chapter ${next}. Write the chapter the book`,
      "needs next and title it accordingly.",
      "",
    )
  }

  if (remaining.length > 1) {
    lines.push(
      `Still to come after this one: ${remaining
        .filter((c) => c.number > next)
        .map((c) => `${c.number}. ${c.title}`)
        .join("; ")}.`,
      "Leave their material to them — do not cover it here.",
      "",
    )
  }

  if (tail) {
    lines.push(
      "The draft currently ends like this. Pick up from it in the same voice,",
      "tense and level of detail — the seam must not be visible:",
      "",
      "<<<DRAFT-TAIL",
      tail,
      "DRAFT-TAIL",
      "",
    )
  }

  lines.push(
    `Output ONLY the new chapter, starting with the heading \`## Chapter ${next}: <title>\`.`,
    "Do not reprint the title page, the contents, or any earlier chapter — they are",
    "already in the document and your reply is appended to it.",
    "1,200 to 2,000 words.",
    "",
    SHARED_RULES,
    "",
    remaining.length <= 1
      ? "This is the last chapter: land the book properly rather than trailing off."
      : "Stop at the end of this chapter. Do not start the next one.",
  )

  return lines.join("\n")
}

/* ------------------------------------------------------------------ storage */

function readAll(): BookProject[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as BookProject[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(projects: BookProject[]) {
  if (typeof window === "undefined") return
  try {
    const trimmed = [...projects]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_PROJECTS)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // A full or blocked store costs the outline, not the draft — the Canvas is
    // saved separately. Not worth interrupting the writing to report.
  }
}

export function loadBookProject(conversationId: string | null): BookProject | null {
  const key = conversationId ?? NEW_CHAT_KEY
  return readAll().find((p) => p.conversationId === key) ?? null
}

export function saveBookProject(project: BookProject) {
  const others = readAll().filter((p) => p.conversationId !== project.conversationId)
  writeAll([...others, { ...project, updatedAt: Date.now() }])
}

/** Move a book started before the conversation existed onto its real id. */
export function rekeyBookProject(conversationId: string) {
  const all = readAll()
  const pending = all.find((p) => p.conversationId === NEW_CHAT_KEY)
  if (!pending) return
  writeAll([
    ...all.filter(
      (p) => p.conversationId !== NEW_CHAT_KEY && p.conversationId !== conversationId,
    ),
    { ...pending, conversationId },
  ])
}

export function clearBookProject(conversationId: string) {
  writeAll(readAll().filter((p) => p.conversationId !== conversationId))
}

/**
 * Re-read the plan from the document after a turn.
 *
 * The draft is the source of truth: it is what the reader can see and what the
 * next turn continues from. Deriving the position from it means an edit made by
 * hand — a chapter deleted in the Canvas — is picked up rather than ignored.
 */
export function syncBookProject(input: {
  previous: BookProject | null
  conversationId: string | null
  brief: string
  document: string
}): BookProject {
  const outline = parseBookOutline(input.document)
  const chapters =
    outline.length >= (input.previous?.chapters.length ?? 0) || !input.previous
      ? outline
      : input.previous.chapters

  return {
    conversationId: input.conversationId ?? NEW_CHAT_KEY,
    title: parseBookTitle(input.document, input.previous?.title ?? "Untitled book"),
    brief: input.previous?.brief || input.brief,
    chapters,
    written: countChaptersWritten(input.document),
    updatedAt: Date.now(),
  }
}
