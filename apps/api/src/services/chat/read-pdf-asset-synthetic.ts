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


/** Prefer an exact quoted filename from slash / summarize prompts. */
export function extractQuotedOrNamedFilename(text: string): string | null {
  const patterns = [
    /(?:named|file)\s+"([^"]+)"/i,
    /Read ONLY the file\s+"([^"]+)"/i,
    /"([^"]+\.(?:pdf|docx?|xlsx?|pptx?|odt|txt|md|csv))"/i,
    // /summarize Arcellite.pdf (raw slash, before expansion)
    /^\/(?:summarize|summarise|read)\s+(.+?\.(?:pdf|docx?|xlsx?|pptx?|odt|txt|md))\s*$/i,
    /\b([\w][\w .'-]*\.(?:pdf|docx?|xlsx?|pptx?|odt))\b/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]?.trim()) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  return null
}

function findDocumentByExactFilename(
  name: string,
  docs: Array<{ id: string; filename: string }>,
): string | null {
  const n = name.toLowerCase().trim()
  if (!n) return null
  const exact = docs.find((d) => d.filename.toLowerCase() === n)
  if (exact) return exact.id
  // Partial: user typed stem without full book title noise
  const byIncludes = docs.filter(
    (d) =>
      d.filename.toLowerCase().includes(n) ||
      n.includes(d.filename.toLowerCase().replace(/\.[^.]+$/, "")),
  )
  if (byIncludes.length === 1) return byIncludes[0]!.id
  // Prefer PDF when the user named a .pdf
  if (n.endsWith(".pdf")) {
    const pdf = byIncludes.find((d) => d.filename.toLowerCase().endsWith(".pdf"))
    if (pdf) return pdf.id
  }
  return null
}

/** Composer attaches books as: "Name.pdf" (id=cmxxxx) */
const ATTACHED_ID_RE = /\(id\s*=\s*(c[a-z0-9]{20,})\)/gi
const ATTACHED_FILE_RE =
  /"([^"]+\.(?:pdf|docx?|xlsx?|pptx?|odt|txt|md))"\s*\(id\s*=\s*(c[a-z0-9]{20,})\)/gi

function parseAttachedFilesFromUserText(
  userText: string,
): Array<{ id: string; filename: string }> {
  const out: Array<{ id: string; filename: string }> = []
  for (const m of userText.matchAll(ATTACHED_FILE_RE)) {
    out.push({ filename: m[1]!.trim(), id: m[2]! })
  }
  if (out.length === 0) {
    for (const m of userText.matchAll(ATTACHED_ID_RE)) {
      out.push({ filename: "", id: m[1]! })
    }
  }
  return out
}

function resolvePdfAssetId(
  userText: string,
  priorUserTexts: string[],
  messages: ChatMsg[],
): string | null {
  // 0) Composer attachment block — trust the explicit id the client sent.
  const attached = parseAttachedFilesFromUserText(userText)
  if (attached.length === 1) return attached[0]!.id
  if (attached.length > 1) {
    // Prefer a PDF when multiple are attached.
    const pdf = attached.find((a) => /\.pdf$/i.test(a.filename))
    return (pdf ?? attached[0])!.id
  }

  const docs = [
    ...parseDocumentsFromMessages(messages),
    ...parseAttachedFilesFromUserText(userText),
  ]
  // Deduplicate by id
  const byId = new Map(docs.map((d) => [d.id, d]))
  const uniqueDocs = [...byId.values()]

  // 1) Explicit asset id in the user message (attachment / paste).
  const explicitId = userText.match(ASSET_ID_RE)?.[1]
  if (explicitId) {
    if (uniqueDocs.some((d) => d.id === explicitId)) return explicitId
    // Client-attached ids are authoritative even when not in the short snapshot.
    if (/\(id\s*=/.test(userText) || /USER ATTACHED FILE/i.test(userText)) {
      return explicitId
    }
  }

  if (uniqueDocs.length === 0) return null

  // 2) Exact / quoted filename from this turn (slash commands).
  const named = extractQuotedOrNamedFilename(userText)
  if (named) {
    const exact = findDocumentByExactFilename(named, uniqueDocs)
    if (exact) return exact
  }

  // 3) [[ASSETS:ids:…]] tags from prior assistant turns only — never scan system context.
  for (const m of [...messages].reverse()) {
    if (m.role !== "assistant") continue
    const tagMatch = [...m.content.matchAll(ASSET_TAG_ID_RE)]
    if (tagMatch.length > 0) {
      const id = tagMatch[tagMatch.length - 1]![1]!
      if (uniqueDocs.some((d) => d.id === id)) return id
    }
  }

  // 4) Fuzzy match on this user turn only (not entire history — avoids wrong docs).
  const fromQuery = findDocumentByHint(userText, uniqueDocs)
  if (fromQuery) return fromQuery

  for (const m of [...messages].reverse()) {
    if (m.role !== "assistant" || !m.content) continue
    const hint = extractFilenameHintFromAssistant(m.content)
    if (!hint) continue
    const fromHint = findDocumentByHint(`${hint}\n${userText}`, uniqueDocs)
    if (fromHint) return fromHint
  }

  return uniqueDocs.length === 1 ? uniqueDocs[0]!.id : null
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
    /\bread_pdf_asset\b/i.test(t) ||
    /\bMUST call read_pdf_asset\b/i.test(t) ||
    /\bSummarize(?:\s+ONLY)?\s+the document or file named\b/i.test(t) ||
    /\bSummarize ONLY\b/i.test(t) ||
    /^\/(?:summarize|summarise)\b/i.test(t)
  ) {
    return true
  }

  // Essay / exam / quiz / study questions / docs from a book need the PDF body.
  if (
    /\b(essay|exam|quiz|test|assessment|worksheet|homework|study\s+guide|questions?|documentation|outline)\b/i.test(
      t,
    ) &&
    (DOC_REFERENT_RE.test(combined) ||
      /\b(this|that|the)\s+(book|pdf|document|paper|file)\b/i.test(t) ||
      /\.pdf\b/i.test(t) ||
      /USER ATTACHED FILE/i.test(t) ||
      /\(id\s*=\s*c[a-z0-9]+\)/i.test(t) ||
      /create\s+an?\s+essay\b/i.test(t))
  ) {
    return true
  }

  // Attached PDF + any write/create intent
  if (
    /USER ATTACHED FILE/i.test(t) &&
    /\b(write|create|generate|prepare|compose|draft|essay|exam|quiz|summar)\b/i.test(t)
  ) {
    return true
  }

  // Any message that names a concrete .pdf and asks to summarize/read it.
  if (
    /\.pdf\b/i.test(t) &&
    /\b(summarize|summarise|summary|read|explain|describe|contents?|essay|exam|quiz|questions?)\b/i.test(
      t,
    )
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
  const named = extractQuotedOrNamedFilename(userText)

  // Ordinal / deictic after a list: first, latest — only when no explicit filename.
  if (docs.length > 0 && !named) {
    if (/\b(first|1st|earliest)\b/.test(t)) {
      return { asset_id: docs[0]!.id }
    }
    if (/\b(latest|last|most\s+recent|newest)\b/.test(t)) {
      return { asset_id: docs[docs.length - 1]!.id }
    }
  }

  // Always prefer exact resolve (quoted name first). Never guess docs[0] when a
  // specific filename was provided and we couldn't match it.
  const assetId = resolvePdfAssetId(userText, priorUserTexts, messages)
  if (assetId) return { asset_id: assetId }

  if (named) {
    // Named file not in the short snapshot — still null so the model can call tools with filename.
    return null
  }

  // Bare "summarize" / "summarize it" with a single doc in context.
  if (
    docs.length === 1 &&
    (BARE_SUMMARIZE_RE.test(userText.trim()) ||
      /^(?:summarize|summarise)\b/i.test(userText.trim()))
  ) {
    return { asset_id: docs[0]!.id }
  }

  return null
}
