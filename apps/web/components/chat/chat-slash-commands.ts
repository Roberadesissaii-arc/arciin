import { HUMANIZE_FULL_BRIEF, auditHumanTells } from "@arciin/shared"

import type { ChatPromptToolId } from "@/components/chat/chat-prompt-box"

export type ChatSlashCommand = {
  id: string
  /** Command name without leading slash */
  name: string
  label: string
  description: string
  /** Placeholder shown after inserting the command */
  hint: string
  /** Auto-enable these composer chips when this command is used */
  tools: ChatPromptToolId[]
  /**
   * Expand to a full natural-language request for the model/tools.
   * `args` is everything after the command name.
   */
  expand: (args: string) => string
}

/**
 * Strong vision prompt so the UI can draw an orange border around an object.
 * Used by /highlight and /border (chat + image Ask AI panel).
 */
export function expandHighlightSlashArgs(args: string): string {
  const target = args.trim()
  const objectPart = target
    ? `Find and highlight this object on the image: **${target}**.`
    : "Find and highlight the **main subject** of this image (the most important person, vehicle, product, or object)."

  return (
    `${objectPart} ` +
    `You can see the image pixels. ` +
    `1) Briefly say in plain language where it is (position / description). ` +
    `2) You MUST draw a border around it by appending ONE hidden marker at the end of your reply (the UI hides the marker and shows an orange box): ` +
    `prefer **[point-box:"label",x1,y1,x2,y2]** with 0–1000 coordinates that tightly wrap the object (not empty background), ` +
    `or **[point-grid:"label",row,col,rows,cols]** for grid/poster layouts. ` +
    `Do not refuse. Do not only describe without a marker — without the marker no border appears. ` +
    `Do not dump raw JSON in the visible answer beyond the required marker.`
  )
}

export const CHAT_SLASH_COMMANDS: ChatSlashCommand[] = [
  {
    id: "modify",
    name: "modify",
    label: "Modify draft",
    description: "Edit the current Canvas draft in place instead of rewriting it",
    hint: "/modify cut the section on monoculture",
    tools: [],
    expand: (args) => {
      const instruction = args.trim() || "improve the draft where it is weakest"

      // The draft body is attached by the caller, which is what makes this an
      // edit rather than a fresh generation: without the current text the model
      // has nothing to revise and simply writes a new essay, which is exactly
      // the behaviour this command exists to stop.
      return (
        `Revise the existing Canvas draft. Do NOT start a new document and do NOT rewrite it from scratch.\n\n` +
        `Change requested: ${instruction}\n\n` +
        `Rules:\n` +
        `- Return the COMPLETE revised document, not a diff, not an excerpt, not a description of what you changed. The Canvas panel replaces its contents with your reply.\n` +
        `- Keep every part the request did not touch byte-identical, including the title, headings, wording and reference list.\n` +
        `- Do not re-order sections, re-title the piece, or "improve" prose that was not mentioned.\n` +
        `- If the request names a section, locate that exact section and change only it.\n` +
        `- If the request is ambiguous about which passage it means, make the smallest reasonable interpretation and say so in one line AFTER the document, separated by a line containing only ---.`
      )
    },
  },
  {
    id: "humanize",
    name: "humanize",
    label: "Humanize",
    description: "Write or rewrite so it reads as human prose, not model prose",
    hint: "/humanize rewrite my intro paragraph",
    tools: [],
    expand: (args) => {
      const request = args.trim()

      // When the writer pastes text, name what is actually wrong with it. A
      // rewrite that silently reshuffles prose teaches nothing and gives no way
      // to check the result.
      const findings = request.length > 200 ? auditHumanTells(request) : []
      const audit =
        findings.length > 0
          ? `\n\nTells already present in this text — fix each and say what you changed:\n${findings
              .map((f) => `- ${f.kind}: ${f.detail}`)
              .join("\n")}`
          : ""

      const task = request
        ? `Task: ${request}`
        : "Task: continue writing the current piece, or rewrite the passage we were just discussing."

      return `${task}\n\n${HUMANIZE_FULL_BRIEF}${audit}`
    },
  },
  {
    id: "summarize",
    name: "summarize",
    label: "Summarize",
    description: "Read a document/PDF and write a full summary",
    hint: "/summarize filename.pdf",
    tools: ["files"],
    expand: (args) => {
      const target = args.trim()
      if (target) {
        return (
          `Summarize ONLY the document or file named "${target}" from my Arciin library. ` +
          `You MUST call read_pdf_asset (for PDFs) or read_text_asset (for text/code) to load the real content first, then write a complete multi-paragraph summary (overview, key points, conclusion). ` +
          `Never stop after saying you will open the file — the tool result already contains the text. ` +
          `Do NOT list other files. Do NOT emit [[ASSET_LIST:…]] or [[ASSETS:…]] tags.`
        )
      }
      return (
        `Summarize ONLY the most relevant single document from my library (prefer the one we just discussed, or the most recent document). ` +
        `You MUST call read_pdf_asset or read_text_asset first, then write a complete multi-paragraph summary. ` +
        `Never stop after saying you will open the file. Do NOT list other files or emit [[ASSET_LIST:…]] / [[ASSETS:…]] tags.`
      )
    },
  },
  {
    id: "read",
    name: "read",
    label: "Read file",
    description: "Open one file and explain it",
    hint: "/read fake.docx",
    tools: ["files"],
    expand: (args) => {
      const target = args.trim() || "the file we discussed"
      return (
        `Read ONLY the file "${target}" from my library. Call read_text_asset (or read_pdf_asset if it is a PDF) with that exact filename. ` +
        `Then explain what THAT file contains in clear language using the tool result. ` +
        `Do not stop after promising to open it. ` +
        `Answer about this one file only — do NOT list other documents, do NOT dump the library, and do NOT emit [[ASSET_LIST:…]] or [[ASSETS:…]] tags.`
      )
    },
  },
  {
    id: "list-documents",
    name: "list-documents",
    label: "List documents",
    description: "Show documents in this instance",
    hint: "/list-documents",
    tools: ["files", "library"],
    expand: () =>
      "List my documents from this Arciin instance. Use live library context and include [[ASSET_LIST:documents]] so I can see the files.",
  },
  {
    id: "list-files",
    name: "list-files",
    label: "List files",
    description: "Show recent files across libraries",
    hint: "/list-files",
    tools: ["files", "library"],
    expand: () =>
      "List my recent files across libraries on this instance. Use real counts and [[ASSET_LIST:all]] when helpful.",
  },
  {
    id: "list-images",
    name: "list-images",
    label: "List images",
    description: "Show recent images from the library (main chat)",
    hint: "/list-images",
    tools: ["library", "vision"],
    expand: () =>
      "Show my recent images. Include [[ASSETS:images]] so preview cards render.",
  },
  {
    id: "list-videos",
    name: "list-videos",
    label: "List videos",
    description: "Show recent videos",
    hint: "/list-videos",
    tools: ["library"],
    expand: () =>
      "Show my recent videos. Include [[ASSETS:videos]] so preview cards render.",
  },
  {
    id: "describe",
    name: "describe",
    label: "Describe image",
    description: "Vision: describe attached / open image",
    hint: "/describe",
    tools: ["vision"],
    expand: (args) => {
      const extra = args.trim()
      return (
        `Describe the image(s) attached to this message in detail (subjects, colors, text, scene).` +
        (extra ? ` Focus on: ${extra}` : "") +
        ` You can see the pixels — never claim you cannot view images.`
      )
    },
  },
  {
    id: "objects",
    name: "objects",
    label: "List objects",
    description: "List what is visible on this image (then use /highlight)",
    hint: "/objects",
    tools: ["vision"],
    expand: (args) => {
      const focus = args.trim()
      return (
        `Look at the open/attached image and list every distinct object, person, vehicle, animal, product, and notable item you can see` +
        (focus ? ` (focus on: ${focus})` : "") +
        `. Number them in a short bullet list with clear short labels I can use next (e.g. "red car", "person in blue shirt"). ` +
        `Do NOT browse the library or list other files. Do NOT emit [[ASSETS:…]] or [[ASSET_LIST:…]] tags. ` +
        `You can see the pixels — answer only from this image. Do not draw highlight boxes unless I ask.`
      )
    },
  },
  {
    id: "highlight",
    name: "highlight",
    label: "Highlight object",
    description: "Vision: find an object and draw an orange border around it",
    hint: "/highlight car",
    tools: ["vision"],
    expand: (args) => expandHighlightSlashArgs(args),
  },
  {
    id: "border",
    name: "border",
    label: "Border object",
    description: "Same as /highlight — draw a border around an object",
    hint: "/border the red car",
    tools: ["vision"],
    expand: (args) => expandHighlightSlashArgs(args),
  },
  {
    id: "search",
    name: "search",
    label: "Search library",
    description: "Search folders and files on this server",
    hint: "/search vacation photos",
    tools: ["library", "files"],
    expand: (args) => {
      const q = args.trim() || "what I have stored"
      return (
        `Search my Arciin libraries for: ${q}. Use library tools and real folders/files on this instance. Do not invent results.`
      )
    },
  },
  {
    id: "organize",
    name: "organize",
    label: "Organize",
    description: "Suggest or apply library organization",
    hint: "/organize images",
    tools: ["library"],
    expand: (args) => {
      const focus = args.trim() || "my media"
      return (
        `Help me organize ${focus} on this Arciin server. Prefer library tools and real folders. Suggest a simple structure and apply safe actions when tools allow.`
      )
    },
  },
]

/** Detect `/command` being typed at the start of a line (or whole input). */
export function getActiveSlashQuery(value: string, cursor?: number): {
  query: string
  replaceStart: number
  replaceEnd: number
} | null {
  const end = cursor ?? value.length
  const before = value.slice(0, end)
  // Slash command only at start of the input or after a newline.
  const match = before.match(/(?:^|\n)(\/[a-zA-Z0-9_-]*)$/)
  if (!match) return null
  const token = match[1] ?? ""
  const replaceStart = end - token.length
  return {
    query: token.slice(1).toLowerCase(),
    replaceStart,
    replaceEnd: end,
  }
}

export function filterSlashCommands(query: string): ChatSlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return CHAT_SLASH_COMMANDS
  return CHAT_SLASH_COMMANDS.filter(
    (c) =>
      c.name.startsWith(q) ||
      c.label.toLowerCase().startsWith(q) ||
      c.name.includes(q),
  )
}

/**
 * Slash commands for the **image Ask AI** panel (single open image).
 * No library browse commands — only actions that make sense on this image.
 */
export const IMAGE_PANEL_SLASH_COMMANDS: ChatSlashCommand[] = CHAT_SLASH_COMMANDS.filter(
  (c) =>
    c.name === "describe" ||
    c.name === "objects" ||
    c.name === "highlight" ||
    c.name === "border",
)

export function filterImagePanelSlashCommands(query: string): ChatSlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return IMAGE_PANEL_SLASH_COMMANDS
  return IMAGE_PANEL_SLASH_COMMANDS.filter(
    (c) =>
      c.name.startsWith(q) ||
      c.label.toLowerCase().startsWith(q) ||
      c.name.includes(q),
  )
}

const KNOWN_SLASH_NAMES = new Set(CHAT_SLASH_COMMANDS.map((c) => c.name))

/**
 * Split input text so known `/command` tokens (start of string or after newline)
 * can be rendered in accent orange inside the composer.
 */
export function splitTextForSlashHighlight(
  text: string,
): Array<{ text: string; isCommand: boolean }> {
  if (!text) return [{ text: "", isCommand: false }]
  const parts: Array<{ text: string; isCommand: boolean }> = []
  // Match /command at line starts (whole-message or after \n)
  const re = /(^|\n)(\/[a-zA-Z0-9_-]+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const fullStart = m.index
    const prefix = m[1] ?? ""
    const token = m[2] ?? ""
    const name = token.slice(1).toLowerCase()
    const tokenStart = fullStart + prefix.length
    if (tokenStart > last) {
      parts.push({ text: text.slice(last, tokenStart), isCommand: false })
    }
    if (KNOWN_SLASH_NAMES.has(name)) {
      parts.push({ text: token, isCommand: true })
    } else {
      parts.push({ text: token, isCommand: false })
    }
    last = tokenStart + token.length
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), isCommand: false })
  }
  if (parts.length === 0) parts.push({ text, isCommand: false })
  return parts
}

/** Insert `/name ` into the input (keeps user free to add args). */
export function insertSlashCommandToken(
  value: string,
  replaceStart: number,
  replaceEnd: number,
  command: ChatSlashCommand,
): string {
  const before = value.slice(0, replaceStart)
  const after = value.slice(replaceEnd)
  return `${before}/${command.name} ${after}`
}

/**
 * If the whole message is a slash command (optionally with args), expand it.
 * Returns null when not a complete command send.
 */
export function expandSlashMessage(raw: string): {
  text: string
  tools: ChatPromptToolId[]
  command: ChatSlashCommand
} | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("/")) return null
  const withoutSlash = trimmed.slice(1)
  const space = withoutSlash.search(/\s/)
  const name = (space === -1 ? withoutSlash : withoutSlash.slice(0, space)).toLowerCase()
  const args = space === -1 ? "" : withoutSlash.slice(space + 1)
  const command = CHAT_SLASH_COMMANDS.find((c) => c.name === name)
  if (!command) return null
  return {
    text: command.expand(args),
    tools: command.tools,
    command,
  }
}
