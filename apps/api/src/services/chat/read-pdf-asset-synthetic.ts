type ChatMsg = { role: string; content: string }

const DOCUMENT_LINE_RE =
  /^\s*-\s+(.+?)\s+id=([a-z0-9]{20,})\s+type=/im

const PDF_CONTENT_QUESTION_RE =
  /\b(page|chapter|section|contents?|inside|talks?\s+about|mentions?|says?\s+about|how\s+to|summar|explain|what\s+does|tell\s+me\s+more|more\s+about|what\s+is\s+(?:it|this|that)\s+about|describe|where\s+(?:in|does)|find\s+(?:in|the)|read\s+(?:the\s+)?(?:book|pdf)|show\s+me\s+the\s+page)\b/i

const DOC_REFERENT_RE =
  /\b(book|pdf|document|ebook|manual|paper|aircraft|modelling|modeling|essay|essays)\b/i

const SHORT_SHOW_RE = /^(?:show\s*(?:me)?|open|view|preview)\s*[!.?]*$/i

const ASSET_ID_RE = /\b(c[a-z0-9]{20,})\b/i

const ASSET_TAG_ID_RE = /\[\[ASSETS:\s*ids:([a-z0-9]+)\]\]/gi

function parseDocumentsFromMessages(messages: ChatMsg[]): Array<{ id: string; filename: string }> {
  const docs: Array<{ id: string; filename: string }> = []
  for (const m of messages) {
    if (m.role !== "system" && !m.content.includes("Documents (")) continue
    for (const line of m.content.split("\n")) {
      const match = line.match(DOCUMENT_LINE_RE)
      if (match) {
        docs.push({ filename: match[1]!.trim(), id: match[2]! })
      }
    }
  }
  return docs
}

function significantWords(text: string): string[] {
  const stop = new Set([
    "about",
    "book",
    "document",
    "have",
    "there",
    "your",
    "the",
    "this",
    "that",
    "pdf",
    "file",
    "show",
    "page",
    "where",
    "talk",
    "create",
    "aircraft",
    "aircrat",
    "tell",
    "more",
    "change",
    "will",
    "that",
    "way",
    "you",
    "think",
    "them",
    "all",
  ])
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d{2,}$/.test(w)) && !stop.has(w))
}

function wordMatchesFilename(word: string, filename: string): boolean {
  if (filename.includes(word)) return true
  if (word.length >= 4 && filename.includes(word.slice(0, 4))) return true
  if (word.endsWith("s") && word.length > 4 && filename.includes(word.slice(0, -1))) return true
  if (!word.endsWith("s") && filename.includes(`${word}s`)) return true
  return false
}

function findDocumentByHint(
  hint: string,
  docs: Array<{ id: string; filename: string }>,
): string | null {
  const words = significantWords(hint)
  if (words.length === 0) return docs.length === 1 ? docs[0]!.id : null

  let bestId: string | null = null
  let bestScore = 0
  for (const doc of docs) {
    const fn = doc.filename.toLowerCase()
    let score = 0
    for (const word of words) {
      if (wordMatchesFilename(word, fn)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestId = doc.id
    }
  }
  const threshold = words.length >= 2 ? 2 : 1
  return bestScore >= threshold ? bestId : docs.length === 1 ? docs[0]!.id : null
}

function extractFilenameHintFromAssistant(text: string): string | null {
  const titleMatch = text.match(
    /\b(?:yes,?\s+you\s+have|you\s+have)\s+(.+?)(?:\s+by\s+|\s*\(|~|\s*—|\s*-\s*\d|\.|$)/i,
  )
  if (titleMatch?.[1]) return titleMatch[1].trim()

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/\.pdf\b/i.test(trimmed) || /\b(book|ebook)\b/i.test(trimmed)) {
      return trimmed.replace(/\s*\(size:\s*[^)]+\)\s*$/i, "").trim()
    }
  }
  return null
}

function extractAssetIdFromMessages(messages: ChatMsg[]): string | null {
  for (const m of [...messages].reverse()) {
    const inline = m.content.match(ASSET_ID_RE)
    if (inline?.[1]) return inline[1]
    const tagMatch = [...m.content.matchAll(ASSET_TAG_ID_RE)]
    if (tagMatch.length > 0) return tagMatch[tagMatch.length - 1]![1]!
  }
  return null
}

function resolvePdfAssetId(
  userText: string,
  priorUserTexts: string[],
  messages: ChatMsg[],
): string | null {
  const docs = parseDocumentsFromMessages(messages)
  if (docs.length === 0) return null

  const explicitId = userText.match(ASSET_ID_RE)?.[1]
  if (explicitId && docs.some((d) => d.id === explicitId)) return explicitId

  const taggedId = extractAssetIdFromMessages(messages)
  if (taggedId && docs.some((d) => d.id === taggedId)) return taggedId

  const combined = [userText, ...priorUserTexts].join("\n")
  const fromQuery = findDocumentByHint(combined, docs)
  if (fromQuery) return fromQuery

  for (const m of [...messages].reverse()) {
    if (m.role !== "assistant" || !m.content) continue
    const hint = extractFilenameHintFromAssistant(m.content)
    if (!hint) continue
    const fromHint = findDocumentByHint(`${hint}\n${userText}`, docs)
    if (fromHint) return fromHint
  }

  return docs.length === 1 ? docs[0]!.id : null
}

const BARE_SUMMARIZE_RE =
  /^(?:please\s+)?(?:summarize|summarise|sum\s*up|tl;?dr|give\s+me\s+a\s+summary)(?:\s+(?:it|that|this|the\s+(?:book|pdf|document|file|one|first|latest|most\s+recent)))?\s*[.!?]*$/i

/** User wants PDF body / page / chapter content (not just a preview card). */
export function isPdfContentQuestion(userText: string, priorUserTexts: string[] = []): boolean {
  const t = userText.trim()
  if (!t) return false
  if (SHORT_SHOW_RE.test(t)) return false

  const combined = `${userText}\n${priorUserTexts.join("\n")}`

  // "summarize" / "summarize it" after listing documents — still a content read.
  if (BARE_SUMMARIZE_RE.test(t) || /^(?:summarize|summarise)\b/i.test(t)) {
    if (
      DOC_REFERENT_RE.test(combined) ||
      /\b(list|documents?|pdfs?|books?|files?)\b/i.test(combined) ||
      /read_pdf_asset|Documents\s*\(/i.test(combined)
    ) {
      return true
    }
  }

  // Explicit slash-style / summarize prompts from the web client.
  if (
    /\bMUST call read_pdf_asset\b/i.test(t) ||
    /\bSummarize the document or file named\b/i.test(t)
  ) {
    return true
  }

  if (PDF_CONTENT_QUESTION_RE.test(t)) {
    return (
      DOC_REFERENT_RE.test(combined) ||
      /\b(that|this|the)\s+(book|pdf|document|essay)\b/i.test(t) ||
      BARE_SUMMARIZE_RE.test(t)
    )
  }

  if (
    /\b(book|pdf|document|ebook|essay|essays)\b/i.test(t) &&
    /\b(tell|more|about|describe|what|explain|summar|inside)\b/i.test(t)
  ) {
    return true
  }

  return false
}

export function buildSyntheticReadPdfAssetArgsFromUser(
  userText: string,
  priorUserTexts: string[] = [],
  messages: ChatMsg[] = [],
): { asset_id: string } | null {
  if (!isPdfContentQuestion(userText, priorUserTexts)) return null

  const docs = parseDocumentsFromMessages(messages)
  const t = userText.trim().toLowerCase()

  // Ordinal / deictic after a list: first, latest, that one, it
  if (docs.length > 0) {
    if (/\b(first|1st|earliest)\b/.test(t)) {
      return { asset_id: docs[0]!.id }
    }
    if (/\b(latest|last|most\s+recent|newest)\b/.test(t)) {
      return { asset_id: docs[docs.length - 1]!.id }
    }
    if (
      docs.length === 1 ||
      BARE_SUMMARIZE_RE.test(userText.trim()) ||
      /^(?:summarize|summarise)\b/i.test(userText.trim())
    ) {
      // Prefer filename match, else first/only document.
      const byHint = resolvePdfAssetId(userText, priorUserTexts, messages)
      if (byHint) return { asset_id: byHint }
      return { asset_id: docs[0]!.id }
    }
  }

  const assetId = resolvePdfAssetId(userText, priorUserTexts, messages)
  if (!assetId) return null

  return { asset_id: assetId }
}
