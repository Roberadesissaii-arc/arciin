import { stripAssistantStreamMarkup } from "@arciin/shared"

import type { Message } from "@/components/chat/chat-message-model"
import { extractListedTitles } from "@/lib/chat/listed-assets"

/**
 * Intent detection + response tag enforcement for chat replies —
 * decides when to attach [[ASSETS:…]] / [[ASSET_LIST:…]] tags, when to
 * attach vision bytes, and strips tags the user did not ask for.
 */

/** User is asking about source code / Python scripts — not image/document previews. */
export function userRequestsCodeFiles(userText: string): boolean {
  const t = userText.trim().toLowerCase()
  return /\b(python|py\s+files?|\.py\b|scripts?|source\s*code|code\s+files?)\b/.test(t)
}

/** Arciin "App data databases" (/database/app-data) vs file libraries — never treat as Documents filenames. */
export function userMeansAppDataDatabases(userText: string): boolean {
  const t = userText.trim().toLowerCase()
  if (!t) return false

  const mentionsStores =
    /\bddb\b/.test(t) ||
    /\bapp\s*-?\s*data\b/.test(t) ||
    /\blogical\s+stores?\b/.test(t) ||
    /\bdatabases?\b/.test(t) ||
    /\b(my|the|all|every|each)\s+(?:registered\s+|logical\s+|app\s*-?\s*data\s+)?(?:databases?|\bdbs?\b)/i.test(t) ||
    /\b(which|what)\s+databases\b/i.test(userText)

  if (!mentionsStores) return false

  if (/\b(images?|videos?|music|documents?)\s+library\b/i.test(userText)) {
    return /\b(app\s*-?\s*data|ddb\b|\blogical\s+stores?|\bapp-databases\b|\bpostgres\s+(?:explorer|table)|\btable\s+browser\b)/i.test(
      userText,
    )
  }

  return true
}

export function stripAssetListsWhenQueryingAppDatabases(content: string, userText: string): string {
  if (!userMeansAppDataDatabases(userText)) return content
  return content.replace(/\n*\[\[ASSET_LIST:[^\]]+\]\]\n*/gi, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** Single-file open/read/summarize — never dump a full library list afterward. */
export function isSingleFileContentRequest(userText: string): boolean {
  const t = userText.trim()
  if (!t) return false
  if (/\binclude\s+\[\[ASSET_LIST:/i.test(t)) return false
  if (/^list\s+my\s+(documents?|files?|images?|videos?)/i.test(t)) return false
  if (/\bread_text_asset\b|\bread_pdf_asset\b|MUST call read_/i.test(t)) return true
  if (/\bRead the file\s+"/i.test(t)) return true
  if (/\bSummarize the document or file named\b/i.test(t)) return true
  if (
    /\b(read|open|summarize|summarise|explain|describe)\b/i.test(t) &&
    /\b[\w.-]+\.(pdf|docx?|xlsx?|pptx?|odt|txt|md|py|js|ts|json|csv)\b/i.test(t)
  ) {
    return true
  }
  return false
}

function stripAllAssetTags(content: string): string {
  return content
    .replace(/\n*\[\[ASSET_LIST:[^\]]+\]\]\n*/gi, "\n")
    .replace(/\n*\[\[ASSETS:[^\]]+\]\]\n*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * "Files" / "uploads" with no library word — the user means the instance as a
 * whole, not one media type.
 *
 * These read as vague, so an earlier gate that required a media noun treated
 * them as small talk and stripped the gallery the model had already produced:
 * "what is the latest upload" answered "here's the most recent file:" followed
 * by nothing at all.
 */
const GENERIC_FILE_NOUN = /\b(uploads?|files?|assets?|additions?)\b/i

/** Recency + a generic file noun: "the latest upload", "my recent files". */
function mentionsRecentUploads(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(latest|newest|last|most\s+recent|recent(?:ly)?|just)\b/.test(t) &&
    GENERIC_FILE_NOUN.test(t)
  )
}

/**
 * Singular phrasing about one upload — "what is the latest upload", "my last
 * file", "what did I just upload". These deserve the one card they named, not
 * a grid of the whole instance.
 */
function userWantsExactlyOneFile(userText: string): boolean {
  const t = normalizeDocumentListQuery(userText).trim().toLowerCase()
  if (!t) return false
  if (userRequestsCodeFiles(userText)) return false
  // Plurals and "all/them" ask for the set, not the single newest file.
  if (/\b(uploads|files|assets|additions|them|those|these|all|every)\b/.test(t)) return false
  if (/\bwhat\s+did\s+i\s+(?:just\s+)?upload(?:ed)?\b/.test(t)) return true
  return /\b(latest|newest|last|most\s+recent)\b[^.?!]{0,24}\b(upload|file|asset|addition|one|item)\b/.test(
    t,
  )
}

/** Generic browse of the whole instance: "my files", "the latest upload", "recent uploads". */
function userWantsGenericFileBrowse(userText: string, priorMessages: Message[]): boolean {
  const t = normalizeDocumentListQuery(userText).trim().toLowerCase()
  if (!t) return false
  if (userRequestsCodeFiles(userText)) return false
  if (userMeansAppDataDatabases(userText)) return false
  // "delete my last upload" is an instruction, not a browse request.
  if (/\b(delete|remove|trash|move|rename|organi[sz]e|sort|share|download)\b/.test(t)) {
    return false
  }

  if (mentionsRecentUploads(t)) return true
  // Bare noun phrases with no verb — "my files", "my uploads", "all my files".
  if (/^(?:my|the|all\s+(?:my|the)?|show\s+my)?\s*(?:recent\s+)?(?:uploads?|files?|assets?)[\s!.,?]*$/.test(t)) {
    return true
  }
  // "what/which files do I have", "what's in my library"
  if (/\b(what|which|any)\b/.test(t) && GENERIC_FILE_NOUN.test(t)) return true

  return affirmsAssistantFileOffer(userText, priorMessages)
}

/** Bare "yes"/"sure" answering an assistant offer to show files. */
function affirmsAssistantFileOffer(userText: string, priorMessages: Message[]): boolean {
  const t = userText.trim()
  if (
    !/^(?:yes|yeah|yea|yep|yup|sure|ok(?:ay)?|please(?:\s+do)?|go\s+ahead|do\s+it|sounds\s+good)[\s!.,?]*$/i.test(
      t,
    )
  ) {
    return false
  }
  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant?.content) return false
  return (
    /\b(show|see|preview|display|view)\b/i.test(lastAssistant.content) &&
    /\b(uploads?|files?|assets?|images?|videos?|music|documents?|books?|pdfs?)\b/i.test(
      lastAssistant.content,
    )
  )
}

/** Recent chat turn mentioned a library type (for follow-ups like "show me"). */
function conversationMentionsMediaType(
  priorMessages: Message[],
  kind: "images" | "videos" | "music" | "documents" | "code" | "files",
): boolean {
  const recent = priorMessages.slice(-8)
  const pattern =
    kind === "images"
      ? /\bimages?|pictures?|photos?\b/i
      : kind === "videos"
        ? /\bvideos?\b/i
        : kind === "music"
          ? /\bmusic|audio\b/i
          : kind === "documents"
            ? /\b(documents?|books?|pdfs?|story\s*books?|ebooks?)\b/i
            : kind === "code"
              ? /\b(python|py\s+files?|\.py\b|scripts?|source\s*code|code\s+files?)\b/i
              : GENERIC_FILE_NOUN

  return recent.some((m) => pattern.test(m.content))
}

/** User explicitly asked to see/browse files this turn (not just counts or greetings). */
function userWantsAssetGallery(userText: string, priorMessages: Message[] = []): boolean {
  const t = normalizeDocumentListQuery(userText).trim()
  if (!t) return false

  if (userRequestsCodeFiles(userText)) return false
  // Cover gallery for books/docs always wins over bare filename list.
  if (userWantsDocumentCovers(userText, priorMessages)) return true
  // "what is the latest upload" / "my files" / "yes" after an offer to show them.
  if (userWantsGenericFileBrowse(userText, priorMessages)) return true
  // Code / non-document filename lists stay text-only (no image cards).
  if (userWantsFilenameList(userText, priorMessages)) {
    const media = resolveAssetListMediaType(userText, priorMessages)
    if (media !== "documents") return false
  }

  if (
    /^(?:hi|hello|hey|howdy|yo|sup|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|thx|ok(?:ay)?|cool|nice|bye|goodbye)[\s!.,?]*$/i.test(
      t,
    )
  ) {
    return false
  }

  const wantsSee =
    /\b(show\s+me|let\s+me\s+see|can\s+i\s+see|display|browse|view\s+my|see\s+my|open\s+my|pull\s+up|look\s+at\s+my|preview)\b/i.test(
      t,
    ) ||
    /\b(show|see|view|open)\s+(?:all\s+)?(?:my\s+)?(?:the\s+)?(?:recent\s+)?/i.test(t) ||
    /\b(preview|cover|thumbnail)\b/i.test(t)
  const mentionsVisualMedia =
    /\b(images?|pictures?|photos?|videos?|music|documents?|books?|pdfs?|ebooks?|library|libraries|media|assets?|uploads?)\b/i.test(
      t,
    )
  const mentionsGenericFiles = /\bfiles?\b/i.test(t) && !userRequestsCodeFiles(userText)

  if (wantsSee && (mentionsVisualMedia || mentionsGenericFiles)) return true

  // "list my books / documents" → cover gallery (not bare text)
  if (userWantsDocumentCovers(userText, priorMessages)) return true

  if (
    /\b(show|see|display)\b/i.test(t) &&
    /\b(recent|latest|newest)\b/i.test(t) &&
    (mentionsVisualMedia || mentionsGenericFiles)
  ) {
    return true
  }

  // Follow-up after a count or list: "show me", "show them", "let me see", "show me the preview"
  const shortShowRequest =
    /^(?:show\s+me(?:\s+the\s+preview)?|show\s+them|show\s+those|show\s+it|let\s+me\s+see|display\s+them|see\s+them|preview(?:\s+them)?|the\s+preview|show\s+previews?)[\s!.,?]*$/i.test(
      t,
    ) || /^show[\s!.,?]*$/i.test(t)

  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "code")) return false
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "images")) return true
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "videos")) return true
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "music")) return true
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "documents")) return true
  // Nothing named a library, but the turn before was about uploads/files.
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "files")) return true

  if (wantsSee && !mentionsVisualMedia && !mentionsGenericFiles) {
    if (conversationMentionsMediaType(priorMessages, "code")) return false
    if (conversationMentionsMediaType(priorMessages, "images")) return true
    if (conversationMentionsMediaType(priorMessages, "videos")) return true
    if (conversationMentionsMediaType(priorMessages, "music")) return true
    if (conversationMentionsMediaType(priorMessages, "documents")) return true
    if (conversationMentionsMediaType(priorMessages, "files")) return true
  }

  return false
}

/** Normalize common typos so "list all bookd" still means books. */
function normalizeDocumentListQuery(userText: string): string {
  return userText
    .replace(/\bbookds?\b/gi, "books")
    .replace(/\bboks?\b/gi, "books")
    .replace(/\bdocumnets?\b/gi, "documents")
    .replace(/\bpdfs\b/gi, "pdfs")
}

/** Books / PDFs / documents should render cover previews, not name-only rows. */
function userWantsDocumentCovers(userText: string, priorMessages: Message[] = []): boolean {
  const t = normalizeDocumentListQuery(userText).trim().toLowerCase()
  if (!t) return false
  if (userRequestsCodeFiles(userText)) return false
  if (userMeansAppDataDatabases(userText)) return false

  // "list all books", "list bookd", "show my documents", "what books do I have"
  if (/\b(books?|pdfs?|ebooks?|story\s*books?|documents?)\b/.test(t)) {
    if (
      /\b(list|show|see|preview|browse|display|cover|thumbnail|what|which|all\s+my|my\s+all|enumerate|name)\b/.test(
        t,
      )
    ) {
      return true
    }
    // "all books" / "every pdf" without an explicit list verb
    if (/\b(all|every|entire)\b/.test(t)) return true
  }

  // Follow-up after talking about books/documents: list/show them, previews, etc.
  if (
    /^(?:show\s+me(?:\s+the\s+preview)?|show\s+them(?:\s+all)?|list\s+them(?:\s+all)?|list\s+all|show\s+all|name\s+them|preview(?:\s+them)?|the\s+preview|show\s+previews?|covers?)[\s!.,?]*$/i.test(
      t,
    ) &&
    conversationMentionsMediaType(priorMessages, "documents")
  ) {
    return true
  }

  // "list them all" / "list all" after a books/documents turn
  if (
    /\b(list|show|name|enumerate)\s+(?:them|those|these|all)(?:\s+all)?\b/i.test(t) &&
    conversationMentionsMediaType(priorMessages, "documents")
  ) {
    return true
  }

  return false
}

function inferGalleryCountFromContext(priorMessages: Message[], media: string): number | null {
  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant?.content) return null
  const c = lastAssistant.content
  const patterns =
    media === "images"
      ? [
          /\b(?:you have|there are|i found|found)\s+(\d+)\s+images?\b/i,
          /\b(\d+)\s+images?\b/i,
        ]
      : media === "videos"
        ? [/\b(?:you have|there are|found)\s+(\d+)\s+videos?\b/i, /\b(\d+)\s+videos?\b/i]
        : media === "music"
          ? [/\b(?:you have|there are|found)\s+(\d+)\s+(?:music|audio|tracks?)\b/i]
          : [/\b(?:you have|there are|found)\s+(\d+)\s+files?\b/i]

  for (const re of patterns) {
    const m = c.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > 0) return Math.min(n, 9)
    }
  }
  return null
}

function resolveGalleryMediaType(userText: string, priorMessages: Message[]): string {
  const t = normalizeDocumentListQuery(userText).toLowerCase()
  if (userRequestsCodeFiles(userText)) return "code"
  if (/\b(documents?|books?|pdfs?|ebooks?|story\s*books?)\b/.test(t)) return "documents"
  if (/\bimages?|pictures?|photos?\b/.test(t)) return "images"
  if (/\bvideos?\b/.test(t)) return "videos"
  if (/\bmusic|audio\b/.test(t)) return "music"
  // No library named — "my files", "the latest upload" span every library.
  if (GENERIC_FILE_NOUN.test(t)) return "all"

  for (const m of [...priorMessages].reverse()) {
    const c = m.content.toLowerCase()
    if (/\bimages?|pictures?|photos?\b/.test(c)) return "images"
    if (/\bvideos?\b/.test(c)) return "videos"
    if (/\bmusic|audio|tracks?\b/.test(c)) return "music"
    if (/\b(documents?|books?|pdfs?|harry\s*potter|\.pdf)\b/.test(c)) return "documents"
    const tag = m.content.match(/\[\[ASSETS:([a-z]+)/i)?.[1]
    if (tag && tag !== "ids") return tag
    if (/\[\[ASSET_LIST:documents\]\]/i.test(m.content)) return "documents"
    if (GENERIC_FILE_NOUN.test(c)) return "all"
  }

  return "images"
}

/**
 * Limit carried over from the gallery the assistant just showed.
 *
 * "show me the preview" after "here's the most recent file" means *that* file
 * again — re-deriving from scratch turned the single card into a full grid.
 */
function lastGalleryLimit(priorMessages: Message[], media: string): number | null {
  for (const m of [...priorMessages].reverse()) {
    if (m.role !== "assistant") continue
    const match = m.content.match(/\[\[ASSETS:([a-z]+)(?::(\d+))?\]\]/i)
    if (!match) continue
    if (match[1].toLowerCase() !== media) return null
    if (!match[2]) return null
    const n = parseInt(match[2], 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

/**
 * Deictic follow-up with no noun of its own — "show me the preview", "show it
 * again". It means the gallery already on screen, so the previous limit holds.
 * A fresh plural noun ("my files") asks for the wider set instead.
 */
function userAsksForSameGalleryAgain(userText: string): boolean {
  const t = userText.trim().toLowerCase()
  if (/\b(uploads|files|assets|them|those|these|all|every|more|other)\b/.test(t)) return false
  return /\b(preview|it|that|this|again|same|one)\b/.test(t)
}

/** Inject [[ASSETS:…]] when the user asked to preview files but the model only replied with prose. */
function ensureAssetGalleryTag(
  content: string,
  userText: string,
  priorMessages: Message[],
): string {
  if (!userWantsAssetGallery(userText, priorMessages)) return content
  if (/\[\[ASSETS:/i.test(content)) {
    // Model showed the library when one file was asked for — narrow it.
    if (userWantsExactlyOneFile(userText)) {
      return content.replace(/\[\[ASSETS:([a-z]+)\]\]/gi, "[[ASSETS:$1:1]]")
    }
    return content
  }

  const media = resolveGalleryMediaType(userText, priorMessages)
  const wantsAll = /\b(all|every|entire|full\s+list)\b/i.test(
    normalizeDocumentListQuery(userText),
  )
  // Prefer a higher limit for "list all books" so covers aren't capped at 9.
  if (media === "documents" && (wantsAll || userWantsDocumentCovers(userText, priorMessages))) {
    const tag = wantsAll ? "[[ASSETS:documents:24]]" : "[[ASSETS:documents]]"
    const trimmed = content.trim()
    return trimmed ? `${trimmed}\n\n${tag}` : tag
  }
  // "the latest upload" names one file — show that card, not the library.
  const singular = userWantsExactlyOneFile(userText)
  const carried = userAsksForSameGalleryAgain(userText)
    ? lastGalleryLimit(priorMessages, media)
    : null
  const count = singular ? 1 : (carried ?? inferGalleryCountFromContext(priorMessages, media))
  const tag = count != null ? `[[ASSETS:${media}:${count}]]` : `[[ASSETS:${media}]]`
  const trimmed = content.trim()
  return trimmed ? `${trimmed}\n\n${tag}` : tag
}

/** Wants to look at something specific: "show me Hamlet", "find the Atlantis book". */
function userWantsToSeeSomething(userText: string): boolean {
  const t = userText.trim().toLowerCase()
  if (!t) return false
  return /\b(show|see|view|open|find|preview|display|pull\s+up|look\s+at|where(?:'s| is))\b/.test(t)
}

/**
 * Cards for a named file when nothing else would have rendered any.
 *
 * "Show me Harry Potter and the Goblet of Fire" names no library, so the
 * gallery gate reads it as chat and the answer arrives with no picture of the
 * book at all. Injecting a *listed* tag is safe where injecting a library
 * gallery would not be: it can only render files the reply already named, so
 * a wrong guess shows nothing rather than 24 unrelated covers.
 */
function ensureListedGalleryTag(content: string, userText: string): string {
  if (/\[\[ASSETS:/i.test(content)) return content
  if (!userWantsToSeeSomething(userText)) return content
  if (userRequestsCodeFiles(userText)) return content
  if (userMeansAppDataDatabases(userText)) return content
  if (extractListedTitles(content).length === 0) return content

  const trimmed = content.trim()
  return trimmed ? `${trimmed}\n\n[[ASSETS:listed]]` : content
}

function assistantRecentlyShowedAssets(priorMessages: Message[]): boolean {
  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant?.content) return false
  return /\[\[ASSETS:/i.test(lastAssistant.content)
}

function userWantsFilenameList(userText: string, priorMessages: Message[]): boolean {
  const t = normalizeDocumentListQuery(userText).trim().toLowerCase()
  if (!t) return false

  if (userMeansAppDataDatabases(userText)) return false

  const wantsBrowseCode =
    userRequestsCodeFiles(userText) &&
    /\b(show\s+me|let\s+me\s+see|display|browse|view|list|what\s+are|which|all|every)\b/.test(t)
  if (wantsBrowseCode) return true

  const listIntent =
    /\b(list|enumerate|filenames?|file\s+names?|name\s+them)\b/.test(t) ||
    /^list\s+(?:them|those|these|it|my|all)\b/.test(t) ||
    /\blist\s+(?:them\s+)?(?:here|again|in\s+chat|all)\b/.test(t) ||
    /\bno,?\s*list\b/.test(t) ||
    /^(?:list\s+all|list\s+them(?:\s+all)?|show\s+all|name\s+them)[\s!.,?]*$/i.test(t)

  if (!listIntent) {
    const shortShow =
      /^(?:show\s+me|show\s+them|show\s+those|let\s+me\s+see)[\s!.,?]*$/i.test(t) ||
      /^show[\s!.,?]*$/i.test(t)
    if (shortShow && conversationMentionsMediaType(priorMessages, "code")) return true
    return false
  }

  if (
    /\b(documents?|books?|pdfs?|files?|images?|pictures?|photos?|videos?|music|python|scripts?|code|\.py|assets?|them|those|these|all)\b/.test(
      t,
    )
  ) {
    return true
  }

  if (
    /\b(list|name)\s+(?:them|those|it|all)\b/.test(t) &&
    (assistantRecentlyShowedAssets(priorMessages) ||
      conversationMentionsMediaType(priorMessages, "documents"))
  ) {
    return true
  }

  return false
}

function resolveAssetListMediaType(userText: string, priorMessages: Message[]): string {
  const t = normalizeDocumentListQuery(userText).toLowerCase()
  if (/\b(python|py\s+files?|\.py|scripts?|source\s*code|code\s+files?)\b/.test(t)) return "code"
  if (/\b(documents?|books?|pdfs?)\b/.test(t) && !/\b(python|\.py|scripts?)\b/.test(t)) {
    return "documents"
  }
  if (/\bimages?|pictures?|photos?\b/.test(t)) return "images"
  if (/\bvideos?\b/.test(t)) return "videos"
  if (/\bmusic|audio\b/.test(t)) return "music"
  if (/\ball\s+files?\b/.test(t)) return "all"

  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === "assistant")
  const tag = lastAssistant?.content.match(/\[\[ASSET_LIST:([a-z]+)/i)?.[1]
  if (tag) return tag
  const assetTag = lastAssistant?.content.match(/\[\[ASSETS:([a-z]+)/i)?.[1]
  if (assetTag) return assetTag

  if (conversationMentionsMediaType(priorMessages, "code")) return "code"

  return "documents"
}

function ensureFilenameListTag(content: string, userText: string, priorMessages: Message[]): string {
  if (userMeansAppDataDatabases(userText)) return content
  if (!userWantsFilenameList(userText, priorMessages) && !userWantsDocumentCovers(userText, priorMessages)) {
    return content
  }
  const media = resolveAssetListMediaType(userText, priorMessages)
  const wantsAll =
    /\b(all|every|entire|full\s+list)\b/i.test(normalizeDocumentListQuery(userText)) ||
    userWantsDocumentCovers(userText, priorMessages)

  // Books / documents → cover gallery (thumbnails), not a bare name list.
  if (media === "documents" || userWantsDocumentCovers(userText, priorMessages)) {
    let out = content
    // Prefer cover cards; demote plain document lists when covers are better.
    if (/\[\[ASSET_LIST:documents\]\]/i.test(out) && !/\[\[ASSETS:documents/i.test(out)) {
      out = out.replace(
        /\[\[ASSET_LIST:documents\]\]/gi,
        wantsAll ? "[[ASSETS:documents:24]]" : "[[ASSETS:documents]]",
      )
    }
    // A model that emitted [[ASSETS:listed]] itself has already answered this.
    // Missing that case appended a second tag, and the reply rendered the same
    // eight covers twice.
    if (
      /\[\[ASSETS:documents/i.test(out) ||
      /\[\[ASSETS:ids:/i.test(out) ||
      /\[\[ASSETS:listed/i.test(out)
    ) {
      return out
    }
    const tag = wantsAll ? "[[ASSETS:documents:24]]" : "[[ASSETS:documents]]"
    const trimmed = out.trim()
    return trimmed ? `${trimmed}\n\n${tag}` : tag
  }

  if (/\[\[ASSET_LIST:/i.test(content)) return content
  const trimmed = content.trim()
  return trimmed ? `${trimmed}\n\n[[ASSET_LIST:${media}]]` : `[[ASSET_LIST:${media}]]`
}

function responseUsesCodeFilenameList(content: string): boolean {
  return /\[\[ASSET_LIST:(?:code|python|py)\]\]/i.test(content)
}

/** Remove [[ASSETS:...]] preview cards when the user wanted a filename list or code files only. */
function stripUnrequestedAssetTags(
  content: string,
  userText: string,
  priorMessages: Message[] = [],
): string {
  if (!/\[\[ASSETS:/i.test(content)) return content

  // [[ASSETS:ids:…]] and [[ASSETS:listed]] survive every strip. Both render
  // only assets the answer already identified — a tool result, or the titles
  // written above the tag — so neither can dump the library, which is the one
  // thing this strip exists to prevent. Removing them left "find X in my
  // library" answering with nothing to look at.
  const stripGallery = () =>
    content
      .replace(/\n*\[\[ASSETS:(?!ids:|listed)[^\]]+\]\]\n*/gi, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

  if (userRequestsCodeFiles(userText)) return stripGallery()
  if (responseUsesCodeFilenameList(content) && !userWantsAssetGallery(userText, priorMessages)) {
    return stripGallery()
  }
  // Always keep document/book cover galleries — never strip after "list books".
  if (
    /\[\[ASSETS:documents/i.test(content) ||
    userWantsDocumentCovers(userText, priorMessages)
  ) {
    return content
  }
  if (/\[\[ASSET_LIST:/i.test(content) && userWantsFilenameList(userText, priorMessages)) {
    // Prefer list over gallery only for non-document media.
    const media = resolveAssetListMediaType(userText, priorMessages)
    if (media !== "documents") return stripGallery()
  }
  if (!userWantsAssetGallery(userText, priorMessages)) return stripGallery()

  return content
}

/** Remove [[ASSET_LIST:…]] unless the user actually asked for a filename list. */
function stripUnrequestedFilenameLists(
  content: string,
  userText: string,
  priorMessages: Message[],
): string {
  if (!/\[\[ASSET_LIST:/i.test(content)) return content
  if (userWantsFilenameList(userText, priorMessages)) return content
  if (/\binclude\s+\[\[ASSET_LIST:/i.test(userText)) return content
  if (/\bList my (?:documents?|files?|recent files)/i.test(userText)) return content
  return content
    .replace(/\n*\[\[ASSET_LIST:[^\]]+\]\]\n*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Point a whole-library gallery at the files the reply actually named.
 *
 * `[[ASSETS:documents]]` renders the most recent documents, which contradicts
 * every filtered answer. Asked to list fictional stories, the reply named 22
 * novels and the covers underneath were TensorFlow manuals and IELTS
 * workbooks — the text was right and the pictures were wrong.
 *
 * Whenever the answer enumerates files, the enumeration wins. A recency
 * gallery only survives when the reply named nothing for it to disagree with.
 */
function scopeGalleryToListedFiles(content: string): string {
  if (!/\[\[ASSET(?:S|_LIST):/i.test(content)) return content
  if (extractListedTitles(content).length === 0) return content

  const scoped = content
    // Never touch [[ASSETS:ids:…]] — tool results already name exact assets.
    .replace(
      /\[\[ASSETS:(?!ids:|listed)([a-z]+)(?::\d+)?\]\]/gi,
      (_match, media: string) => `[[ASSETS:listed:${media.toLowerCase()}]]`,
    )
    // Documents only: for code and other media the filename rows are the
    // answer, and swapping them for cards would remove information.
    .replace(/\[\[ASSET_LIST:documents\]\]/gi, "[[ASSETS:listed:documents]]")

  return keepOneListedTag(scoped)
}

/**
 * One list, one grid.
 *
 * Every tag here renders the same set — the titles written above it — so a
 * second one is always a repeat. They arrive from two directions: the model
 * emitting its own tag, and a tag injected beside it. Rather than police every
 * producer, the last step keeps the first and drops the rest.
 */
function keepOneListedTag(content: string): string {
  let seen = false
  return content
    .replace(/\n*\[\[ASSETS:listed(?::[a-z]+)?\]\]\n*/gi, (match) => {
      if (seen) return "\n"
      seen = true
      return match
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Post-process a finished assistant reply: enforce/strip asset tags for the user's actual intent. */
export function finalizeAssistantContent(
  content: string,
  userText: string,
  priorMessages: Message[] = [],
  options: { streaming?: boolean } = {},
): string {
  // Always strip leaked tool markup first (never show <tool_call> to users).
  let out = stripAssistantStreamMarkup(content)

  // Canvas / long-form write: never inject library gallery or asset lists.
  if (
    /\b(essay|exam|quiz|documentation|outline|study\s+guide|worksheet|create\s+an?\s+essay|prepare\s+an?\s+exam)\b/i.test(
      userText,
    ) ||
    /USER ATTACHED FILE/i.test(userText)
  ) {
    return stripAllAssetTags(out)
  }

  // Single-file read/summarize: never pad with library dumps.
  if (isSingleFileContentRequest(userText)) {
    return stripAllAssetTags(out)
  }

  out = stripUnrequestedAssetTags(out, userText, priorMessages)
  out = stripUnrequestedFilenameLists(out, userText, priorMessages)

  // Injection is deliberately skipped while the reply is still streaming.
  //
  // These helpers append a gallery tag to whatever text exists so far. Run per
  // chunk, that meant the very first chunk — with no prose yet — produced a
  // message that was *only* the tag, so the file grid rendered instantly and
  // the model's sentence ("Here are your PDFs…") then appeared above it. The
  // reader watched a finished-looking grid get pushed down by text arriving
  // afterwards. Stripping still runs every chunk, so nothing leaks; only the
  // decision to *add* a gallery waits until the answer is complete.
  if (!options.streaming) {
    out = ensureFilenameListTag(out, userText, priorMessages)
    out = ensureAssetGalleryTag(out, userText, priorMessages)
    out = ensureListedGalleryTag(out, userText)
  }
  out = stripUnrequestedAssetTags(out, userText, priorMessages)
  out = stripUnrequestedFilenameLists(out, userText, priorMessages)
  out = stripAssetListsWhenQueryingAppDatabases(out, userText)
  // Last: whatever tag survived, the cards follow the answer's own list.
  out = scopeGalleryToListedFiles(out)
  return stripAssistantStreamMarkup(out)
}

function assistantRecentlyShowedImages(priorMessages: Message[]): boolean {
  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant?.content) return false
  return /\[\[ASSETS:images(?::\d+)?\]\]/i.test(lastAssistant.content)
}

/** Library search/organize — handled by server tools, not ad-hoc vision attach. */
function isLibraryToolChatRequest(userText: string): boolean {
  const t = userText.toLowerCase()
  if (
    /\b(organiz|sort|arrang|categor|group)\w*/.test(t) &&
    /\b(folder|library|image|photo|file)\b/.test(t)
  ) {
    return true
  }
  if (
    (/\b(find|search|look for|locate|show me|get me)\b/.test(t) ||
      /\b(is there|do i have)\b/.test(t)) &&
    /\b(image|picture|photo|library)\b/.test(t)
  ) {
    return true
  }
  return false
}

/** When true, Arciin will attach recent library image bytes for Ollama vision models. */
export function shouldAttachVisionToUserMessage(userText: string, priorMessages: Message[]): boolean {
  const t = userText.trim()
  if (t.length === 0) return false
  if (isLibraryToolChatRequest(t)) return false

  const afterImageCard = assistantRecentlyShowedImages(priorMessages)

  const mentionsVisual =
    /\b(images?|pictures?|photos?|thumbnails?|screenshots?|visuals?)\b/i.test(t)
  const wantsDescription =
    /\b(describ|explain|tell|about|caption|subject|depict|see|look|contains|showing|identify|mean)\w*/i.test(t) ||
    /\bwhat(?:'s| is)\s+(?:in\s+)?(?:it|this|that)\b/i.test(t) ||
    /\bwhat(?:'s| is)\s+in\b/i.test(t)
  const deicticImage = /\b(this|that|the)\s+(image|picture|photo)\b/i.test(t)
  const deicticShort = /\b(this|that|it)\b/i.test(t) && t.length < 120

  if (mentionsVisual && wantsDescription) return true
  if (deicticImage && wantsDescription) return true
  if (afterImageCard && (deicticImage || (wantsDescription && (deicticShort || mentionsVisual)))) return true
  if (afterImageCard && /\b(can you|could you|please)\b/i.test(t) && /\b(describ|discrib|explain)\w*/i.test(t)) {
    return true
  }
  if (/\b(first|latest|most recent|last)\s+(image|picture|photo)\b/i.test(t) && wantsDescription) return true
  if (/\bwhat(?:'s| is)\s+in\s+(?:the\s+)?(?:image|picture|photo)\b/i.test(t)) return true
  return false
}
