const CUID_LIKE_RE = /\b(cm[a-z0-9]{8,})\b/i

/** Common misspellings users type for "delete" in chat. */
const REMOVE_VERB_RES =
  /\b(?:delete|dlete|delte|discard|purge|unlink|removed?|remove|rm|trash)\b/i

/** User clearly wants folder deletion/removal via chat — not sorting/organizing. */
export function isExplicitFolderDeleteMessage(userText: string): boolean {
  const t = userText.toLowerCase()
  if (!/\bfolders?\b/.test(t)) return false
  if (!REMOVE_VERB_RES.test(userText)) return false
  if (/\bdon'?t\b/.test(t)) return false
  return true
}

/** User asks to create a named folder via chat (lightweight heuristic). */
export function isExplicitFolderCreateMessage(userText: string): boolean {
  const t = userText.toLowerCase()
  if (/\bdon'?t\b/.test(t)) return false
  if (!/\bfolders?\b/.test(t)) return false
  if (/\b(create|add|make|start)\b/.test(t)) return true
  if (/\bnew\s+folders?\b/.test(t)) return true
  return false
}

export function inferLibrarySlugFromUserText(userText: string): string {
  const t = userText.toLowerCase()
  if (/\binbox\b/.test(t)) return "inbox"
  if (/\bdocument(s)?(\s+library)?\b|\bpdf\b/.test(t)) return "documents"
  if (/\bmusic\b|\baudio\b/.test(t)) return "music"
  if (/\bvideo(s)?(\s+library)?\b/.test(t)) return "videos"
  if (/\b(image|picture|photo)(s|\s+library)?\b/.test(t)) return "images"
  return "images"
}

function extractQuotedSegment(userText: string): string | null {
  const m = userText.match(/["”“]([^"”“]{1,120})["”“]/)
  const s = m?.[1]?.trim()
  return s && s.length > 0 ? s : null
}

/** Name hint for delete/remove when no folder id in the prompt. */
export function extractFolderNameForDeleteMutation(userText: string): string | null {
  const quoted = extractQuotedSegment(userText)
  if (quoted && quoted.length <= 120) return quoted.trim()

  if (!isExplicitFolderDeleteMessage(userText)) return null

  const afterKeyword = userText.match(
    /\bfolders?\b\s+(?:called|named|titled|=|:)\s*(["”“'])([^\n"”.!?]{1,120})\1/i,
  )
  if (afterKeyword?.[2]) return afterKeyword[2].trim()

  const trailing = userText.match(/\bfolder\s+(["”“']?)([^\n.!?]{1,120})\1?\s*$/i)?.[2]
    ?? userText.match(/\bfolders?\s*[,:]\s*(["”“'])([^"”“']+)\1/i)?.[2]
  if (!trailing) return null

  return trailing
    .replace(/^["”“']+|["”“']+$/g, "")
    .replace(/\b(this|that)\s+$/i, "")
    .replace(/\sfolder\b$/i, "")
    .trim()
    .slice(0, 120) || null
}

/** Words that follow "create a folder …" but are location fillers, never the name. */
const CREATE_NAME_STOPWORDS = new Set([
  "in", "inside", "into", "under", "within", "on", "at", "for", "of", "to",
  "the", "a", "an", "my", "that", "this", "it", "called", "named", "titled", "there", "here",
])

/** Trim quotes/articles/trailing punctuation from a candidate folder name. */
function cleanupFolderName(raw: string): string | null {
  // Cut location suffixes first: "Gemini in videos" → "Gemini" (library is inferred separately).
  const beforeLocation = raw.split(/\s+(?:in|inside|into|under|within)\s+/i)[0]!
  const s = beforeLocation
    .replace(/^["”“'\s]+|["”“'\s]+$/g, "")
    .replace(/^\s*(?:the|a|an)\s+/i, "")
    .replace(/\s*(?:folder|library)\s*$/i, "")
    .replace(/[\s.,:;!?]+$/g, "")
    .replace(/^["”“']+|["”“']+$/g, "")
    .trim()
  if (s.length < 1 || s.length > 100) return null
  if (CREATE_NAME_STOPWORDS.has(s.toLowerCase())) return null
  return s
}

/** Name hint for create-folder flows. */
export function extractFolderNameForCreateMutation(userText: string): string | null {
  const quoted = extractQuotedSegment(userText)
  if (quoted && quoted.length <= 120) return quoted.trim()

  if (!isExplicitFolderCreateMessage(userText)) return null

  // "called/named/titled <name>" anywhere — tolerate speech-to-text punctuation
  // right after the keyword ("Video called. Gemini").
  const called = /\b(?:called|named|titled)\b[\s.:,\-]*["”“']?([A-Za-z0-9][\w\-+.&' ]{0,98})/i.exec(
    userText,
  )?.[1]
  if (called) {
    const cleaned = cleanupFolderName(called)
    if (cleaned) return cleaned
  }

  const labeled = /\bfolders?\s+(?:with\s+the\s+name|=|:)\s*["”“']?([^\n"”.!?]{1,100})/i.exec(
    userText,
  )?.[1]
  if (labeled?.trim()) {
    const cleaned = cleanupFolderName(labeled)
    if (cleaned) return cleaned
  }

  // "create a folder X" — only when X does not start with a location filler
  // ("create a folder inside videos" must not name the folder "inside").
  const loose = /\bcreate\s+(?:a\s+)?(?:new\s+)?folder\s+([^\n.!?]{1,100})/i.exec(userText)?.[1]?.trim()
  if (loose) {
    const firstWord = loose.split(/\s+/)[0]!.toLowerCase()
    if (!CREATE_NAME_STOPWORDS.has(firstWord)) {
      const cleaned = cleanupFolderName(loose)
      if (cleaned) return cleaned
    }
  }

  const tail = /\b(?:folders?)\s+(["”“'])?([a-z][\w\s\-+.]{2,96}[a-z0-9])\1?\s*$/i.exec(userText)?.[2]
  if (!tail) return null
  const firstTailWord = tail.split(/\s+/)[0]!.toLowerCase()
  if (CREATE_NAME_STOPWORDS.has(firstTailWord)) return null
  return cleanupFolderName(tail)
}

export function extractLikelyFolderId(userText: string): string | null {
  const m = userText.match(CUID_LIKE_RE)
  return m?.[1] ?? null
}

/** Build delete_library_folder JSON args when the user's message implies deletion. */
export function buildSyntheticDeleteLibraryFolderArgsFromUser(userText: string): Record<
  string,
  unknown
> | null {
  if (!isExplicitFolderDeleteMessage(userText)) return null

  const idPhrase =
    /\bfolders?\s+(?:with\s+)?(?:id|ID)\s*=?\s*:?\s*(cm[a-z0-9]+)/i.exec(userText)?.[1]
    ?? /\bfolder_?id\b\s*[=:]\s*(cm[a-z0-9]+)/i.exec(userText)?.[1]
  if (idPhrase) return { folder_id: idPhrase }

  const nameFromText = extractFolderNameForDeleteMutation(userText)
  if (nameFromText)
    return { library_slug: inferLibrarySlugFromUserText(userText), folder_name: nameFromText }

  const loneId = extractLikelyFolderId(userText)
  if (loneId && isExplicitFolderDeleteMessage(userText)) return { folder_id: loneId }

  return null
}

/** Build create_library_folder JSON args from user text. */
export function buildSyntheticCreateLibraryFolderArgsFromUser(userText: string): Record<
  string,
  unknown
> | null {
  if (!isExplicitFolderCreateMessage(userText)) return null
  const name = extractFolderNameForCreateMutation(userText)
  if (!name || name.length < 1 || name.length > 100) return null
  return { library_slug: inferLibrarySlugFromUserText(userText), name }
}

/**
 * When the assistant prints pseudo-tool prose like
 * `[delete_library_folder: folderId: cmxxx]` instead of native tool_calls.
 */
export function extractBracketPseudoToolCalls(text: string): Array<{
  name: string
  arguments: Record<string, unknown>
}> {
  const out: Array<{ name: string; arguments: Record<string, unknown> }> = []
  const re =
    /\[\s*(delete_library_folder|create_library_folder)\s*:\s*([^\]]+)]/gi

  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = String(m[1]).toLowerCase()
    const body = String(m[2])

    const args: Record<string, unknown> = {}
    const folderId =
      /\bfolder_?id\b\s*[=:]\s*(cm[a-z0-9]+)/i.exec(body)?.[1]
      ?? /\bid\b\s*[=:]\s*(cm[a-z0-9]+)/i.exec(body)?.[1]
    const slugRaw = /\blibrary_?slug\b\s*[=:]\s*(videos|images|music|documents|inbox|[a-z0-9_-]+)/i.exec(
      body,
    )?.[1]
    const folderName =
      /\bfolder_?name\b\s*[=:]\s*["”]([^"”]+)["”]/i.exec(body)?.[1]
      ?? /\bfolder_?name\b\s*[=:]\s*([^\],}\s][^\],}]{0,118})/i.exec(body)?.[1]?.trim()

    if (slugRaw) args.library_slug = String(slugRaw).toLowerCase().trim()

    if (name === "delete_library_folder") {
      if (folderId) {
        args.folder_id = folderId
        out.push({ name, arguments: args })
        continue
      }
      if (folderName && (args.library_slug || slugRaw)) {
        args.folder_name = folderName
        if (!args.library_slug) args.library_slug = "images"
        out.push({ name, arguments: args })
        continue
      }
      if (folderName) {
        args.folder_name = folderName
        args.library_slug = args.library_slug ?? "images"
        out.push({ name, arguments: args })
      }
      continue
    }

    if (name === "create_library_folder") {
      const n =
        /\bname\b\s*[=:]\s*["”]([^"”]+)["”]/i.exec(body)?.[1]
        ?? /\bname\b\s*[=:]\s*([^\],}\s][^\],}]{0,98})/i.exec(body)?.[1]?.trim()
      if (n) {
        args.name = n
        if (!args.library_slug) args.library_slug = "images"
        out.push({ name, arguments: args })
      }
    }
  }

  return out
}

const LIBRARY_WORD_TO_SLUG: Record<string, string> = {
  video: "videos",
  videos: "videos",
  image: "images",
  images: "images",
  picture: "images",
  pictures: "images",
  photo: "images",
  photos: "images",
  music: "music",
  audio: "music",
  document: "documents",
  documents: "documents",
  pdf: "documents",
  inbox: "inbox",
}

const LIB_WORDS = "videos?|images?|pictures?|photos?|music|audio|documents?|pdf|inbox"

/**
 * Models sometimes narrate a folder mutation instead of emitting a native
 * tool call — “creating a folder called "Gemini" in the Videos library”,
 * “Let me create the "Gemini" folder inside Videos”, “Calling
 * delete_library_folder with folder id cm…”. Scrape those into real calls.
 */
export function extractProseLibraryFolderMutations(text: string): Array<{
  name: string
  arguments: Record<string, unknown>
}> {
  // Legacy: delete narrated with an explicit tool name + folder id.
  const id =
    /\bdelete_library_folder\b[\s\S]{0,500}?\bfolder\b\s+id\s+(?:is\s+|=|:)?\s*(cm[a-z0-9]{8,})\b/i.exec(text)?.[1]
  if (id) return [{ name: "delete_library_folder", arguments: { folder_id: id } }]

  const libSlug = (word: string | undefined): string | null =>
    word ? (LIBRARY_WORD_TO_SLUG[word.toLowerCase()] ?? null) : null

  // create … folder … "Name" … in/inside <Library>
  const createA = new RegExp(
    `\\bcreat(?:e|ing|ed)\\b[\\s\\S]{0,120}?\\bfolder\\b[\\s\\S]{0,80}?["”“']([^"”“'\\n]{1,100})["”“'][\\s\\S]{0,60}?\\b(?:in|inside|into|under)\\b[\\s\\S]{0,30}?\\b(${LIB_WORDS})\\b`,
    "i",
  ).exec(text)
  // create … "Name" … folder … in/inside <Library>
  const createB = new RegExp(
    `\\bcreat(?:e|ing|ed)\\b[\\s\\S]{0,80}?["”“']([^"”“'\\n]{1,100})["”“'][\\s\\S]{0,40}?\\bfolder\\b[\\s\\S]{0,60}?\\b(?:in|inside|into|under)\\b[\\s\\S]{0,30}?\\b(${LIB_WORDS})\\b`,
    "i",
  ).exec(text)
  // create … folder called/named Name (unquoted) in <Library>
  const createC = new RegExp(
    `\\bcreat(?:e|ing|ed)\\b[\\s\\S]{0,120}?\\bfolder\\b\\s+(?:called|named)\\s+([A-Za-z0-9][\\w\\-+.& ]{0,60}?)\\s+(?:in|inside|into|under)\\b[\\s\\S]{0,30}?\\b(${LIB_WORDS})\\b`,
    "i",
  ).exec(text)

  const create = createA ?? createB ?? createC
  if (create) {
    const name = create[1]?.trim()
    const slug = libSlug(create[2])
    if (name && slug) {
      return [{ name: "create_library_folder", arguments: { library_slug: slug, name } }]
    }
  }

  // delete/remove … folder … "Name" … in/inside <Library> (and the reversed order)
  const deleteA = new RegExp(
    `\\b(?:delet(?:e|ing|ed)|remov(?:e|ing|ed))\\b[\\s\\S]{0,120}?\\bfolder\\b[\\s\\S]{0,80}?["”“']([^"”“'\\n]{1,100})["”“'][\\s\\S]{0,60}?\\b(?:in|inside|from)\\b[\\s\\S]{0,30}?\\b(${LIB_WORDS})\\b`,
    "i",
  ).exec(text)
  const deleteB = new RegExp(
    `\\b(?:delet(?:e|ing|ed)|remov(?:e|ing|ed))\\b[\\s\\S]{0,80}?["”“']([^"”“'\\n]{1,100})["”“'][\\s\\S]{0,40}?\\bfolder\\b[\\s\\S]{0,60}?\\b(?:in|inside|from)\\b[\\s\\S]{0,30}?\\b(${LIB_WORDS})\\b`,
    "i",
  ).exec(text)

  const del = deleteA ?? deleteB
  if (del) {
    const folderName = del[1]?.trim()
    const slug = libSlug(del[2])
    if (folderName && slug) {
      return [
        { name: "delete_library_folder", arguments: { library_slug: slug, folder_name: folderName } },
      ]
    }
  }

  return []
}

/**
 * Assistant text claims a folder action is happening/done without a tool
 * result — “I've sent the request”, “creating it now”, “I'll invoke the
 * folder creation tool”. Used to fall back to args parsed from the user turn.
 */
export function assistantClaimsFolderMutation(text: string): "create" | "delete" | null {
  const claims =
    /\b(?:i(?:'|’)?ve\s+(?:sent|created|removed|deleted)|i(?:'|’)?ll\s+(?:create|delete|remove|invoke|run)|let\s+me\s+(?:create|delete|remove|confirm|run)|creat(?:ing|ed)\s+(?:it|a|the)|sent\s+the\s+request|invoke\s+the\s+folder)/i.test(
      text,
    )
  if (!claims) return null
  if (/\b(?:delet|remov)\w*[\s\S]{0,60}?\bfolder\b/i.test(text)) return "delete"
  if (/\b(?:creat|mak)\w*[\s\S]{0,60}?\bfolder\b/i.test(text)) return "create"
  if (/\bfolder\s+(?:creation|deletion)\b/i.test(text)) {
    return /\bdeletion\b/i.test(text) ? "delete" : "create"
  }
  return null
}
