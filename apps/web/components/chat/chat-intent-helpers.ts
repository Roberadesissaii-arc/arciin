import type { Message } from "@/components/chat/chat-message-model"

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
            ? /\bdocuments?\b/i
            : kind === "code"
              ? /\b(python|py\s+files?|\.py\b|scripts?|source\s*code|code\s+files?)\b/i
              : /\bfiles?\b/i

  return recent.some((m) => pattern.test(m.content))
}

/** User explicitly asked to see/browse files this turn (not just counts or greetings). */
function userWantsAssetGallery(userText: string, priorMessages: Message[] = []): boolean {
  const t = userText.trim()
  if (!t) return false

  if (userRequestsCodeFiles(userText)) return false
  if (userWantsFilenameList(userText, priorMessages)) return false

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
    /\b(show|see|view|open)\s+(?:all\s+)?(?:my\s+)?(?:the\s+)?(?:recent\s+)?/i.test(t)
  const mentionsVisualMedia =
    /\b(images?|pictures?|photos?|videos?|music|documents?|library|libraries|media|assets?|uploads?)\b/i.test(
      t,
    )
  const mentionsGenericFiles = /\bfiles?\b/i.test(t) && !userRequestsCodeFiles(userText)

  if (wantsSee && (mentionsVisualMedia || mentionsGenericFiles)) return true

  if (
    /\b(show|see|display)\b/i.test(t) &&
    /\b(recent|latest|newest)\b/i.test(t) &&
    (mentionsVisualMedia || mentionsGenericFiles)
  ) {
    return true
  }

  // Follow-up after a count or list: "show me", "show them", "let me see"
  const shortShowRequest =
    /^(?:show\s+me|show\s+them|show\s+those|show\s+it|let\s+me\s+see|display\s+them|see\s+them|preview\s+them)[\s!.,?]*$/i.test(
      t,
    ) || /^show[\s!.,?]*$/i.test(t)

  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "code")) return false
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "images")) return true
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "videos")) return true
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "music")) return true
  if (shortShowRequest && conversationMentionsMediaType(priorMessages, "documents")) return true

  if (wantsSee && !mentionsVisualMedia && !mentionsGenericFiles) {
    if (conversationMentionsMediaType(priorMessages, "code")) return false
    if (conversationMentionsMediaType(priorMessages, "images")) return true
    if (conversationMentionsMediaType(priorMessages, "videos")) return true
    if (conversationMentionsMediaType(priorMessages, "music")) return true
    if (conversationMentionsMediaType(priorMessages, "documents")) return true
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
  const t = userText.toLowerCase()
  if (userRequestsCodeFiles(userText)) return "code"
  if (/\bdocuments?\b/.test(t)) return "documents"
  if (/\bimages?|pictures?|photos?\b/.test(t)) return "images"
  if (/\bvideos?\b/.test(t)) return "videos"
  if (/\bmusic|audio\b/.test(t)) return "music"
  if (/\ball\s+files?\b/.test(t)) return "all"

  for (const m of [...priorMessages].reverse()) {
    const c = m.content.toLowerCase()
    if (/\bimages?|pictures?|photos?\b/.test(c)) return "images"
    if (/\bvideos?\b/.test(c)) return "videos"
    if (/\bmusic|audio|tracks?\b/.test(c)) return "music"
    if (/\bdocuments?\b/.test(c)) return "documents"
    const tag = m.content.match(/\[\[ASSETS:([a-z]+)/i)?.[1]
    if (tag && tag !== "ids") return tag
  }

  return "images"
}

/** Inject [[ASSETS:…]] when the user asked to preview files but the model only replied with prose. */
function ensureAssetGalleryTag(
  content: string,
  userText: string,
  priorMessages: Message[],
): string {
  if (!userWantsAssetGallery(userText, priorMessages)) return content
  if (/\[\[ASSETS:/i.test(content)) return content

  const media = resolveGalleryMediaType(userText, priorMessages)
  const count = inferGalleryCountFromContext(priorMessages, media)
  const tag = count != null ? `[[ASSETS:${media}:${count}]]` : `[[ASSETS:${media}]]`
  const trimmed = content.trim()
  return trimmed ? `${trimmed}\n\n${tag}` : tag
}

function assistantRecentlyShowedAssets(priorMessages: Message[]): boolean {
  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant?.content) return false
  return /\[\[ASSETS:/i.test(lastAssistant.content)
}

function userWantsFilenameList(userText: string, priorMessages: Message[]): boolean {
  const t = userText.trim().toLowerCase()
  if (!t) return false

  if (userMeansAppDataDatabases(userText)) return false

  const wantsBrowseCode =
    userRequestsCodeFiles(userText) &&
    /\b(show\s+me|let\s+me\s+see|display|browse|view|list|what\s+are|which|all|every)\b/.test(t)
  if (wantsBrowseCode) return true

  const listIntent =
    /\b(list|enumerate|filenames?|file\s+names?|name\s+them)\b/.test(t) ||
    /^list\s+(?:them|those|these|it|my)\b/.test(t) ||
    /\blist\s+(?:them\s+)?(?:here|again|in\s+chat)\b/.test(t) ||
    /\bno,?\s*list\b/.test(t)

  if (!listIntent) {
    const shortShow =
      /^(?:show\s+me|show\s+them|show\s+those|let\s+me\s+see)[\s!.,?]*$/i.test(t) ||
      /^show[\s!.,?]*$/i.test(t)
    if (shortShow && conversationMentionsMediaType(priorMessages, "code")) return true
    return false
  }

  if (
    /\b(documents?|files?|images?|pictures?|photos?|videos?|music|python|scripts?|code|\.py|assets?|them|those|these)\b/.test(
      t,
    )
  ) {
    return true
  }

  if (/\b(list|name)\s+(?:them|those|it)\b/.test(t) && assistantRecentlyShowedAssets(priorMessages)) {
    return true
  }

  return false
}

function resolveAssetListMediaType(userText: string, priorMessages: Message[]): string {
  const t = userText.toLowerCase()
  if (/\b(python|py\s+files?|\.py|scripts?|source\s*code|code\s+files?)\b/.test(t)) return "code"
  if (/\bdocuments?\b/.test(t) && !/\b(python|\.py|scripts?)\b/.test(t)) return "documents"
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
  if (!userWantsFilenameList(userText, priorMessages)) return content
  if (/\[\[ASSET_LIST:/i.test(content)) return content
  const media = resolveAssetListMediaType(userText, priorMessages)
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

  const stripGallery = () =>
    content
      .replace(/\n*\[\[ASSETS:[^\]]+\]\]\n*/gi, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

  if (userRequestsCodeFiles(userText)) return stripGallery()
  if (responseUsesCodeFilenameList(content) && !userWantsAssetGallery(userText, priorMessages)) {
    return stripGallery()
  }
  if (/\[\[ASSET_LIST:/i.test(content) && userWantsFilenameList(userText, priorMessages)) {
    return stripGallery()
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

/** Post-process a finished assistant reply: enforce/strip asset tags for the user's actual intent. */
export function finalizeAssistantContent(
  content: string,
  userText: string,
  priorMessages: Message[] = [],
): string {
  // Single-file read/summarize: never pad with library dumps.
  if (isSingleFileContentRequest(userText)) {
    return stripAllAssetTags(content)
  }

  let out = stripUnrequestedAssetTags(content, userText, priorMessages)
  out = stripUnrequestedFilenameLists(out, userText, priorMessages)
  out = ensureFilenameListTag(out, userText, priorMessages)
  out = ensureAssetGalleryTag(out, userText, priorMessages)
  out = stripUnrequestedAssetTags(out, userText, priorMessages)
  out = stripUnrequestedFilenameLists(out, userText, priorMessages)
  out = stripAssetListsWhenQueryingAppDatabases(out, userText)
  return out
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
