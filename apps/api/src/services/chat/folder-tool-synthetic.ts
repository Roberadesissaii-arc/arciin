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

/** Name hint for create-folder flows. */
export function extractFolderNameForCreateMutation(userText: string): string | null {
  const quoted = extractQuotedSegment(userText)
  if (quoted && quoted.length <= 120) return quoted.trim()

  if (!isExplicitFolderCreateMessage(userText)) return null

  const labeled =
    /\bfolders?\s+(?:called|named|with\s+the\s+name|=|:)\s*(["”“'])([^\n"’.!?]{1,100})\1/i.exec(userText)?.[2]
      ?? /\bcreate\s+(?:a\s+)?folder\s+(?:called|named)\s+(["”“'])([^"”“']+)\1/i.exec(userText)?.[2]
      ?? /\bcreate\s+(?:a\s+)?folder\s+([^\n.!?]{1,100})/i.exec(userText)?.[1]?.trim()

  if (labeled?.trim()) return labeled.trim()

  const tail = /\b(?:folders?)\s+(["”“'])?([a-z][\w\s\-+.]{2,96}[a-z0-9])\1?\s*$/i.exec(userText)?.[2]
  return tail?.trim() ?? null
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

/** Models sometimes emit prose like “Calling delete_library_folder with folder id cm…” — scrape a real id. */
export function extractProseLibraryFolderMutations(text: string): Array<{
  name: string
  arguments: Record<string, unknown>
}> {
  const id =
    /\bdelete_library_folder\b[\s\S]{0,500}?\bfolder\b\s+id\s+(?:is\s+|=|:)?\s*(cm[a-z0-9]{8,})\b/i.exec(text)?.[1]
  if (!id) return []
  return [{ name: "delete_library_folder", arguments: { folder_id: id } }]
}
