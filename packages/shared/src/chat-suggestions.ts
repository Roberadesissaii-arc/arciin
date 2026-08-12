/**
 * Suggested next actions in chat.
 *
 * Two moments where a blank composer is the wrong thing to show:
 *
 *   1. Just after attaching a file. The reader knows what they attached and has
 *      no idea what this thing can do with it. "Message Arciin…" is not an
 *      answer to that.
 *   2. Just after a reply lands. There is almost always an obvious next move —
 *      save the draft, tighten a section, go deeper on a chapter — and making
 *      the reader type it out is friction for no reason.
 *
 * Suggestions are derived from what is actually on screen (the file's media
 * type, whether a canvas draft exists, what the last reply did) rather than
 * from a fixed list, so they stay true as the conversation moves. They fill the
 * composer rather than sending, because a one-click send that guesses wrong
 * costs a whole generation.
 *
 * Pure: no React, no API. Every rule is unit-testable.
 */

export type ChatSuggestion = {
  id: string
  /** Chip label — short enough to read at a glance. */
  label: string
  /** Text placed in the composer. May be a slash command. */
  prompt: string
}

export type AttachmentKind = "document" | "image" | "video" | "audio" | "code" | "other"

/** Map an asset's media type / extension onto the kinds that change suggestions. */
export function attachmentKindFor(input: {
  mediaType?: string | null
  extension?: string | null
  filename?: string | null
}): AttachmentKind {
  const media = (input.mediaType ?? "").toUpperCase()
  if (media === "IMAGE") return "image"
  if (media === "VIDEO") return "video"
  if (media === "AUDIO") return "audio"
  if (media === "CODE") return "code"
  if (media === "DOCUMENT") return "document"

  const ext = (input.extension ?? input.filename?.split(".").pop() ?? "").toLowerCase()
  if (["pdf", "epub", "docx", "doc", "txt", "md", "rtf"].includes(ext)) return "document"
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "image"
  if (["mp4", "mov", "mkv", "webm"].includes(ext)) return "video"
  if (["mp3", "m4a", "wav", "flac"].includes(ext)) return "audio"
  if (["ts", "tsx", "js", "py", "go", "rs", "sh", "sql", "json", "yml", "yaml"].includes(ext)) {
    return "code"
  }
  return "other"
}

/**
 * Chips to offer once something is attached.
 *
 * Deliberately short lists. A dozen options is a menu to read, not a shortcut —
 * the point is to remove a decision, not add one.
 */
export function attachmentSuggestions(input: {
  kind: AttachmentKind
  filename?: string | null
  count?: number
}): ChatSuggestion[] {
  const many = (input.count ?? 1) > 1

  switch (input.kind) {
    case "document":
      return [
        { id: "summarize", label: "Summarize", prompt: "/summarize " + (input.filename ?? "") },
        {
          id: "essay",
          label: "Write an essay",
          prompt: "Write an essay about this book, with an introduction and a conclusion.",
        },
        {
          id: "research",
          label: "Research paper",
          prompt:
            "Write a research paper based on this document. Include section headings and a reference list.",
        },
        {
          id: "keypoints",
          label: "Key points",
          prompt: "Pull out the key points, chapter by chapter.",
        },
        {
          id: "questions",
          label: "Study questions",
          prompt: "Write study questions covering the main arguments in this document.",
        },
      ]

    case "image":
      return [
        { id: "describe", label: "Describe", prompt: "What is in this image?" },
        { id: "extract", label: "Read the text", prompt: "Read any text in this image." },
        { id: "highlight", label: "Highlight", prompt: "/highlight " },
      ]

    case "code":
      return [
        { id: "explain", label: "Explain", prompt: "Explain what this file does." },
        { id: "review", label: "Review", prompt: "Review this code and flag anything risky." },
        { id: "docs", label: "Document", prompt: "Write documentation for this file." },
      ]

    case "video":
    case "audio":
      return [
        { id: "about", label: "What is this?", prompt: "What is this file?" },
        { id: "details", label: "Details", prompt: "Show the technical details of this file." },
      ]

    default:
      return [
        {
          id: "about",
          label: many ? "About these files" : "About this file",
          prompt: many ? "What are these files?" : "What is this file?",
        },
      ]
  }
}

// ---------------------------------------------------------------------------
// After a reply
// ---------------------------------------------------------------------------

export type ReplyContext = {
  /** True when this turn produced or updated a Canvas draft. */
  hasCanvasDraft?: boolean
  /** True when the draft has not been saved to Documents yet. */
  canvasUnsaved?: boolean
  /** Headings found in the draft, in order. Drives "expand section X". */
  sectionTitles?: string[]
  /** True when the reply listed library files. */
  listedAssets?: boolean
  /** Length of the reply body, used to avoid suggesting "go deeper" on a stub. */
  replyWordCount?: number
}

/**
 * What to offer after a reply lands.
 *
 * Canvas suggestions use /modify so a follow-up edits the existing draft rather
 * than generating a second one — the failure this feature exists to prevent.
 */
export function followUpSuggestions(context: ReplyContext): ChatSuggestion[] {
  const suggestions: ChatSuggestion[] = []

  if (context.hasCanvasDraft) {
    // Named sections first: a concrete "tighten the Overview" is far more
    // useful than a generic "improve it", and it proves the edit is targeted.
    const section = context.sectionTitles?.find((title) => title.trim().length > 0)
    if (section) {
      suggestions.push({
        id: "expand-section",
        label: `Expand "${truncate(section, 22)}"`,
        prompt: `/modify expand the "${section}" section with more detail`,
      })
    }

    suggestions.push(
      { id: "shorter", label: "Make it shorter", prompt: "/modify cut this down by about a third" },
      {
        id: "humanize",
        label: "Warmer tone",
        prompt: "/modify rewrite in a warmer, less formal voice",
      },
    )

    if (context.canvasUnsaved) {
      suggestions.push({
        id: "save",
        label: "Save to Documents",
        prompt: "Save this draft to my Documents library.",
      })
    }
    return suggestions.slice(0, 4)
  }

  if (context.listedAssets) {
    return [
      { id: "summarize", label: "Summarize one", prompt: "/summarize " },
      { id: "essay", label: "Write about one", prompt: "Write an essay about " },
    ]
  }

  if ((context.replyWordCount ?? 0) >= 60) {
    return [
      { id: "deeper", label: "Go deeper", prompt: "Go deeper on that." },
      { id: "simpler", label: "Explain simply", prompt: "Explain that more simply." },
    ]
  }

  return []
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

// ---------------------------------------------------------------------------
// Describing a finished draft
// ---------------------------------------------------------------------------

/** Markdown headings, in document order, without their hashes. */
export function canvasSectionTitles(content: string): string[] {
  const titles: string[] = []
  let inFence = false

  for (const line of content.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    if (heading) titles.push(heading[2]!.replace(/[*_`]/g, "").trim())
  }

  return titles
}

/**
 * One sentence describing what was just written.
 *
 * Built from the document's own headings and length rather than from adjectives,
 * because "a compelling, comprehensive piece" says nothing and is exactly the
 * kind of filler the reader is trying to get away from. Naming the first and
 * last section tells them the shape of what they got.
 */
export function describeCanvasDraft(input: {
  content: string
  words?: number
}): string {
  const titles = canvasSectionTitles(input.content)
  const words = input.words ?? input.content.trim().split(/\s+/).filter(Boolean).length

  const length = words > 0 ? `about ${words.toLocaleString()} words` : "a short draft"

  if (titles.length === 0) {
    return `I've written ${length}. It's in the Canvas panel.`
  }

  if (titles.length === 1) {
    return `I've written ${length} under “${titles[0]}”. It's in the Canvas panel.`
  }

  const first = titles[0]!
  const last = titles[titles.length - 1]!
  return `I've written ${length} across ${titles.length} sections, from “${first}” to “${last}”. It's in the Canvas panel.`
}
