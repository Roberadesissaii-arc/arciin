/**
 * Matching an assistant's own list of titles back to library assets.
 *
 * A `[[ASSETS:documents]]` tag renders the *most recent* documents, which is
 * right for "show me my books" and wrong for every filtered answer. Asked to
 * list fictional stories, the reply named 22 novels and then rendered cover
 * cards for TensorFlow manuals and IELTS workbooks — the prose and the cards
 * disagreed, and the cards are what people look at.
 *
 * So when a reply enumerates files, the cards follow the enumeration: these
 * helpers pull the titles out of the answer and match them against the library
 * by content rather than by recency.
 */

/** Lines that are list items: "1. Title", "- Title", "* Title", "• Title". */
const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+(.+?)\s*$/

/**
 * Openers that mark an item as an action, not a file.
 *
 * A reply can end with "1. Clean up the duplicates / 2. Show the covers", and
 * those must not be mistaken for titles to render.
 */
const ACTION_OPENER_RE =
  /^(?:clean|show|move|delete|remove|rename|organi[sz]e|sort|open|tap|ask|let|want|would|i can|you can|use|try|check|keep|merge|combine)\b/i

/** Provenance junk in filenames — never part of a title anyone would type. */
const NOISE_TOKENS = new Set([
  "z", "lib", "org", "zlib", "zlibrary", "pdf", "epub", "mobi", "azw3", "djvu",
])

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "to", "for", "with", "from",
  "by", "at", "its", "it", "is", "as",
])

/** Strip markdown emphasis, links, and leading emoji from a list item. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]+/u, "")
    .trim()
}

/**
 * Drop bracketed groups.
 *
 * On the listed side this removes the annotations a model adds — "(2 copies)",
 * "(Book 1)", "(3 copies — two identical)" — which otherwise swamp the real
 * title's words and sink the match score.
 */
function stripBracketed(text: string): string {
  return text.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ")
}

/**
 * One list item, several books.
 *
 * Models compress a series onto a single line — "The Atlantis Gene / Plague /
 * World" or "Sorcerer's Stone / Chamber of Secrets / Goblet of Fire". Read as
 * one title those match nothing at all, which is how a reply naming 22 books
 * rendered 8 cards.
 *
 * Splitting alone is not enough: the later segments are bare words that lean
 * on the first for meaning. "World" on its own matches six unrelated books in
 * a real library — Learning Java, Physics of the Impossible — so a segment too
 * short to stand up borrows the head's leading words. "The Atlantis Gene /
 * World" becomes "The Atlantis Gene" and "Atlantis World", not "World".
 *
 * Only slashes with space around them split: `TCP/IP` and `and/or` are one word.
 */
function headPrefix(head: string): string {
  const words = head.split(/\s+/)
  for (let i = words.length - 1; i >= 0; i--) {
    if (tokenize(words[i]!).length > 0) {
      return words.slice(0, i).join(" ").trim()
    }
  }
  return ""
}

function splitCompoundTitle(text: string): string[] {
  const segments = text.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean)
  if (segments.length < 2) return segments.length === 1 ? segments : []

  const head = segments[0]!
  // The head's own last meaningful word is what the later segments replace, so
  // everything before it is the shared context. Taken from the original words
  // rather than the tokens, so the title stays readable.
  const sharedPrefix = headPrefix(head)

  const out = [head]
  for (const segment of segments.slice(1)) {
    const standalone = tokenize(segment).length >= 2
    if (standalone || !sharedPrefix) {
      out.push(segment)
    } else {
      out.push(`${sharedPrefix} ${segment}`)
    }
  }
  return out
}

/**
 * A note the model appended after a dash, rather than part of the title.
 *
 * "Departure — the series opener" and "The Atlantis Gene — Book 1" are one
 * book each; the words after the dash describe rather than name, and counted
 * as title words they sink the score — Departure matched nothing at all, and
 * "Book 1" pinned the Gene entry to the single copy whose filename happens to
 * say Book 1, hiding its duplicate.
 *
 * A real subtitle is longer: "Mythology — Timeless Tales of Gods and Heroes"
 * keeps its tail and stays one precise title, which is what stops it matching
 * Mythology 101. So the head is offered *in addition*, only for short tails.
 */
const ANNOTATION_TAIL_MAX_TOKENS = 2

function annotationHead(title: string): string | null {
  const parts = /^(.+?)\s+[—–-]\s+(.+)$/.exec(title)
  if (!parts) return null
  const head = parts[1]!.trim()
  const tail = parts[2]!.trim()
  if (tokenize(tail).length > ANNOTATION_TAIL_MAX_TOKENS) return null
  if (tokenize(head).length === 0) return null

  // Short is not enough: "Harry Potter — The Complete Collection" is a title
  // carried across the dash, and offering "Harry Potter" there would pull in
  // all seven volumes for an entry naming one file. A note reads differently —
  // it starts lowercase ("the series opener") or carries a number ("Book 1").
  const looksLikeNote = /^\p{Ll}/u.test(tail) || /\d/.test(tail)
  return looksLikeNote ? head : null
}

/**
 * Bold titles in prose, when the reply has no list at all.
 *
 * A one-file answer is a sentence, not a list: "Here's **Harry Potter and the
 * Goblet of Fire** from your Sci-Fi & Fantasy folder." With nothing to read,
 * the grid rendered nothing while the next line said "tap the cover" — the
 * same dangling promise this whole mechanism exists to remove.
 *
 * Only when there are no list items, because in a list the bold spans are
 * headings and counts ("**8 Atlantis books**") that name no file.
 */
const BOLD_SPAN_RE = /\*\*([^*\n]{2,120})\*\*/g

function boldTitlesInProse(content: string): string[] {
  const out: string[] = []
  for (const match of content.matchAll(BOLD_SPAN_RE)) {
    const text = stripBracketed(match[1]!).replace(/\s{2,}/g, " ").trim()
    if (tokenize(text).length === 0) continue
    out.push(text)
  }
  return out
}

/** Titles the assistant enumerated in this reply, in the order given. *//** Titles the assistant enumerated in this reply, in the order given. */
export function extractListedTitles(content: string): string[] {
  const titles: string[] = []
  const seen = new Set<string>()

  for (const line of content.split("\n")) {
    const item = LIST_ITEM_RE.exec(line)
    if (!item) continue

    let text = stripMarkdown(item[1]!)
    if (!text || text.endsWith("?")) continue
    if (ACTION_OPENER_RE.test(text)) continue

    text = stripBracketed(text).replace(/\s{2,}/g, " ").trim()
    // Trailing separators left behind by an annotation that has been removed.
    text = text.replace(/[\s—–:,.;-]+$/u, "").trim()
    if (text.length < 2) continue

    for (const candidate of splitCompoundTitle(text)) {
      const cleaned = candidate.replace(/[\s—–:,.;-]+$/u, "").trim()
      if (cleaned.length < 2) continue
      push(cleaned)
      // Offered alongside, never instead: if the full line matches, both do.
      const head = annotationHead(cleaned)
      if (head) push(head)
    }
  }

  if (titles.length === 0) {
    for (const bold of boldTitlesInProse(content)) push(bold)
  }

  return titles

  function push(title: string) {
    const key = title.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    titles.push(title)
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !NOISE_TOKENS.has(t) && !STOPWORDS.has(t))
}

/** Equal, or one is a prefix of the other — "sorcerer" vs "sorcerers". */
function tokenMatches(needle: string, hay: string[]): boolean {
  return hay.some((t) => {
    if (t === needle) return true
    if (needle.length >= 4 && t.startsWith(needle)) return true
    if (t.length >= 4 && needle.startsWith(t)) return true
    return false
  })
}

/** Share of the title's own words that the asset text carries. */
function titleScore(titleTokens: string[], assetTokens: string[]): number {
  if (titleTokens.length === 0) return 0
  const hits = titleTokens.filter((t) => tokenMatches(t, assetTokens)).length
  return hits / titleTokens.length
}

/** Below this a title is about a different book that merely shares a word. */
const MATCH_THRESHOLD = 0.75

export function titleMatchesAsset(title: string, assetText: string): boolean {
  const titleTokens = tokenize(stripBracketed(title))
  const assetTokens = tokenize(assetText)
  if (titleTokens.length === 0 || assetTokens.length === 0) return false

  // A one-word title is too weak for prefix matching — "gene" would pull in
  // every genetics textbook. Demand the whole word.
  if (titleTokens.length === 1) {
    const only = titleTokens[0]!
    return only.length >= 4 && assetTokens.includes(only)
  }

  return titleScore(titleTokens, assetTokens) >= MATCH_THRESHOLD
}

/**
 * Assets named by the listed titles, ordered by where each first appears.
 *
 * One title may legitimately match several assets — "The Atlantis World"
 * covers the three copies sitting in the library — so this is a filter, not a
 * lookup, and every copy is shown.
 */
export function matchAssetsToTitles<T>(
  assets: T[],
  titles: string[],
  assetText: (asset: T) => string,
): T[] {
  if (titles.length === 0) return []

  const ranked: { asset: T; rank: number }[] = []

  assets.forEach((asset, index) => {
    const text = assetText(asset)
    const rank = titles.findIndex((title) => titleMatchesAsset(title, text))
    if (rank === -1) return
    ranked.push({ asset, rank: rank * 10_000 + index })
  })

  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.asset)
}
