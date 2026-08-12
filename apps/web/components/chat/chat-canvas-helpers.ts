/**
 * Canvas smart routing + title helpers.
 * Canvas chip open ≠ every reply goes to Canvas — only long-form writing.
 */

import { describeCanvasDraft, stripAssistantStreamMarkup } from "@arciin/shared"

/** True when the user is asking for Canvas long-form output (essay, exam, quiz, etc.). */
export function isCanvasWritingIntent(userText: string): boolean {
  const t = userText.trim()
  if (!t) return false

  // Explicit non-writing: list / search / status / short Q&A
  if (
    /^(list|show|find|search|count|what|which|where|when|who|how many|do i have|are there|is there)\b/i.test(
      t,
    )
  ) {
    // "create questions" / "write essay" still writing
    if (
      !/\b(write|draft|compose|essay|article|story|exam|quiz|questions?|test|worksheet|homework)\b/i.test(
        t,
      )
    ) {
      return false
    }
  }
  if (
    /\b(list|show|find|search)\s+(all\s+)?(my\s+)?(books?|files?|documents?|pdfs?|images?|videos?|music|folders?|libraries?)\b/i.test(
      t,
    )
  ) {
    return false
  }
  // Summarize/read alone → chat, unless they also asked for essay/exam/questions in Canvas
  if (
    /\b(summarize|summarise|read|open)\b/i.test(t) &&
    !/\b(essay|article|draft|story|exam|quiz|questions?|test|worksheet)\b/i.test(t)
  ) {
    return false
  }

  // Academic / teaching long-form / docs
  if (
    /\b(essay|article|story|draft|report|letter|blog\s*post|white\s*paper|chapter|poem|screenplay|manuscript|write-?up|writeup|documentation|docs?|manual|outline|how[- ]to|handbook)\b/i.test(
      t,
    )
  ) {
    return true
  }
  // Exam / quiz / study questions / practice tests from a book or paper
  if (
    /\b(exam|quiz|test|assessment|worksheet|homework|study\s+guide|flash\s*cards?|practice\s+(?:questions?|test|exam)|discussion\s+questions?)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(create|generate|make|prepare|write|build|design)\b.{0,60}\b(questions?|exam|quiz|test|assessment|worksheet|homework)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(questions?|exam|quiz|test)\b.{0,40}\b(from|about|on|for|based on)\b.{0,40}\b(book|pdf|document|paper|chapter|this)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(write|compose|draft|author|create|generate|prepare)\b.{0,80}\b(essay|article|story|report|letter|document|post|paper|chapter|poem|exam|quiz|questions?)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (/\bwrite\s+(me\s+)?(an?\s+|the\s+|my\s+)?/i.test(t) && t.length > 24) {
    return true
  }
  if (/\b(long[- ]form|in\s+(the\s+)?canvas|put\s+(this|it)\s+in\s+(the\s+)?canvas)\b/i.test(t)) {
    return true
  }

  return false
}

/** Which Canvas document template to request from the model. */
export type CanvasDocumentKind =
  | "essay"
  | "exam"
  | "questions"
  | "study_guide"
  | "documentation"
  | "outline"
  | "story"
  | "generic"

export function detectCanvasDocumentKind(userText: string): CanvasDocumentKind {
  const t = userText.toLowerCase()
  if (
    /\b(exam|quiz|test|assessment)\b/.test(t) ||
    /\bprepare\s+(an?\s+)?exam\b/.test(t) ||
    /\bpractice\s+(test|exam)\b/.test(t)
  ) {
    return "exam"
  }
  if (
    /\b(questions?|worksheet|homework|discussion\s+questions?|flash\s*cards?)\b/.test(t) ||
    /\b(create|generate|make|write)\b.{0,40}\bquestions?\b/.test(t)
  ) {
    return "questions"
  }
  if (/\b(study\s+guide|revision\s+notes|cheat\s+sheet)\b/.test(t)) {
    return "study_guide"
  }
  if (
    /\b(documentation|docs?|manual|how[- ]to|guide|handbook|spec|specification|readme)\b/.test(t) ||
    /\b(create|write|generate)\b.{0,40}\b(documentation|docs?|manual)\b/.test(t)
  ) {
    return "documentation"
  }
  if (/\b(outline|bullet\s+points?|structure)\b/.test(t)) {
    return "outline"
  }
  if (/\b(story|narrative|fiction)\b/.test(t)) {
    return "story"
  }
  if (/\b(essay|article|paper|report|thesis)\b/.test(t)) {
    return "essay"
  }
  return "generic"
}

function cleanTitle(raw: string, max = 72): string {
  const t = raw
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.?!]+$/g, "")
    .trim()
  if (!t) return "Canvas"
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * Best-effort title from the user prompt (before content exists).
 * Prefers quoted book names, "about X", and genre labels.
 */
export function deriveCanvasTitle(userText: string): string {
  const t = userText.trim()
  if (!t) return "Untitled draft"

  // Quoted title: write an essay about "The Alchemist"
  const quoted =
    t.match(/["“]([^"”]{2,80})["”]/)?.[1] ||
    t.match(/['‘]([^'’]{2,80})['’]/)?.[1]
  if (quoted) return cleanTitle(quoted)

  // essay/article about|on|for X
  const about = t.match(
    /\b(?:essay|article|story|report|draft|paper|letter|post)\s+(?:about|on|for|regarding|of)\s+(.+?)(?:\s*[.?!]|$)/i,
  )?.[1]
  if (about) return cleanTitle(about)

  // write about X / write me something about X
  const writeAbout = t.match(
    /\b(?:write|compose|draft|generate)\b(?:\s+\w+){0,6}\s+(?:about|on|for)\s+(.+?)(?:\s*[.?!]|$)/i,
  )?.[1]
  if (writeAbout) return cleanTitle(writeAbout)

  if (/\bessay\b/i.test(t)) return "Essay"
  if (/\bstory\b/i.test(t)) return "Story"
  if (/\breport\b/i.test(t)) return "Report"
  if (/\bletter\b/i.test(t)) return "Letter"
  if (/\bdraft\b/i.test(t)) return "Draft"
  if (/\boutline\b/i.test(t)) return "Outline"

  return cleanTitle(t, 48)
}

/**
 * Refine title once the model produces content (prefer first markdown H1 / title line).
 */
export function refineCanvasTitleFromContent(content: string, fallback: string): string {
  const body = content.trim()
  if (!body) return fallback || "Untitled draft"

  const h1 = body.match(/^#\s+(.+)$/m)?.[1]
  if (h1) return cleanTitle(h1, 80)

  // First non-empty line if it looks like a short title
  const firstLine = body.split(/\n/).map((l) => l.trim()).find(Boolean)
  if (firstLine && firstLine.length <= 80 && !/[.!?]$/.test(firstLine) && firstLine.length >= 3) {
    // Skip list-y or markdown junk
    if (!/^[-*•\d]/.test(firstLine) && !/^```/.test(firstLine)) {
      return cleanTitle(firstLine.replace(/^\*+|\*+$/g, "").replace(/^_+|_+$/g, ""), 80)
    }
  }

  return fallback || "Untitled draft"
}

/** Safe filename for saving a canvas draft into Documents. */
export function canvasTitleToFilename(title: string, ext = "md"): string {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim() || "Untitled draft"
  return `${base}.${ext}`
}

const CANVAS_PREAMBLE =
  /^(?:sure|okay|ok|alright|certainly|of course|absolutely|got it|right|yes|yeah|let me|i(?:'ll| will| can| am going to)|here(?:'s| is)|i(?:'m| am) (?:going to|about to)|working on|writing|drafting)\b/i

const CANVAS_TRAILER =
  /(?:\n|^)\s*(?:would you like|let me know if|hope (?:this|that) helps|if you (?:want|need)|shall i|want me to)\b[\s\S]*$/i

/**
 * Keep only the document body for Canvas — drop chatty preambles / process talk.
 * Applied while streaming and on final content.
 */
export function sanitizeCanvasDocument(content: string): string {
  // Never leak tool-call XML into the Canvas panel.
  let t = stripAssistantStreamMarkup(content).replace(/\r\n/g, "\n").trim()
  if (!t) return ""

  // Extra pass: standalone tool JSON lines, asset tags, process narration
  t = t
    .replace(/<\/?\s*tool_call\b[^>]*>/gi, "")
    .replace(/(?:^|\n)\s*\{\s*"asset_id"\s*:\s*"[^"]+"\s*\}\s*(?=\n|$)/gi, "\n")
    .replace(/\n*\[\[ASSETS:[^\]]+\]\]\n*/gi, "\n")
    .replace(/\n*\[\[ASSET_LIST:[^\]]+\]\]\n*/gi, "\n")
    .replace(/\[(?:Attempting to read|Reading)[^\]]*\]/gi, "")
    .replace(
      /(?:^|\n)\s*(?:I need to read|Let me (?:read|open|fetch)|I(?:'ll| will) (?:read|open)|Attempting to read)[^\n]{0,200}/gi,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // Prefer starting at the first markdown heading when preamble is chatty.
  const headingMatch = t.match(/(^|\n)(#\s+[^\n]+)/)
  if (headingMatch && headingMatch.index != null) {
    const start = headingMatch.index + (headingMatch[1] ? headingMatch[1].length : 0)
    const before = t.slice(0, start).trim()
    if (!before || CANVAS_PREAMBLE.test(before) || before.length < 280) {
      // Keep heading start when before is empty, short, or preamble-like.
      if (!before || CANVAS_PREAMBLE.test(before.split("\n")[0] ?? "")) {
        t = t.slice(start).trim()
      }
    }
  }

  // Strip leading meta lines before real content.
  const lines = t.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!.trim()
    if (!line) {
      i++
      continue
    }
    if (CANVAS_PREAMBLE.test(line) && !line.startsWith("#") && line.length < 160) {
      i++
      continue
    }
    if (
      /^(?:i(?:'ll| will)|let me|here is|here'?s|okay[,!]?\s+i|sure[,!]?\s+i)\b/i.test(line) &&
      !line.startsWith("#")
    ) {
      i++
      continue
    }
    break
  }
  t = lines.slice(i).join("\n").trim()

  // Normalize heading depth: models overuse ####; cap deep headings at ### for readability.
  // Keep a single # title; promote ## sections; collapse ####+ → ###.
  t = t
    .replace(/^#{5,}\s+/gm, "### ")
    .replace(/^####\s+/gm, "### ")

  // Unwrap fenced blocks that are clearly prose/lists (not real code).
  t = t.replace(/```(?:text|markdown|md|plain|plaintext)?\s*\n([\s\S]*?)```/gi, (_, body: string) => {
    const b = body.trim()
    // Keep fence if it looks like code (braces, imports, etc.)
    if (/^(import |const |let |function |class |#include|def |package )/m.test(b)) {
      return `\`\`\`\n${body}\`\`\``
    }
    return body.trimEnd() + "\n"
  })

  // Drop trailing assistant "offers" / process closers.
  t = t.replace(CANVAS_TRAILER, "").trim()

  return t
}

/** Word count for chat completion summaries. */
export function countCanvasWords(content: string): number {
  const text = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return 0
  return text.split(" ").filter(Boolean).length
}

/**
 * Short chat-side status after Canvas finishes — what was written, not the essay body.
 */
export function buildCanvasFinishedChatSummary(opts: {
  title: string
  content: string
  userText?: string
  attachedFilenames?: string[]
}): string {
  const title = (opts.title || "Untitled draft").trim()
  const words = countCanvasWords(opts.content)
  const hasRefs =
    /^##\s+(references|works cited|bibliography|sources)\b/im.test(opts.content) ||
    /\b(references|works cited|bibliography)\b/i.test(opts.content.slice(-1200))
  const hasIntro = /^##\s+introduction\b/im.test(opts.content)
  const hasConclusion = /^##\s+conclusion\b/im.test(opts.content)

  const structure: string[] = []
  if (hasIntro) structure.push("introduction")
  if (hasConclusion) structure.push("conclusion")
  if (hasRefs) structure.push("references")

  const about =
    opts.attachedFilenames?.length === 1
      ? opts.attachedFilenames[0]!.replace(/\.pdf$/i, "")
      : opts.attachedFilenames && opts.attachedFilenames.length > 1
        ? opts.attachedFilenames.map((f) => f.replace(/\.pdf$/i, "")).join(", ")
        : null

  const lines: string[] = []
  // Lead with a sentence about what was actually written. The metadata block
  // below is accurate but reads like a receipt; this says what the reader got.
  lines.push(describeCanvasDraft({ content: opts.content, words }))
  lines.push(`**Finished in Canvas:** ${title}`)
  if (about) {
    lines.push(`Based on: **${about}**`)
  } else if (opts.userText?.trim()) {
    const short = opts.userText.replace(/\s+/g, " ").trim().slice(0, 100)
    lines.push(`Request: ${short}${opts.userText.trim().length > 100 ? "…" : ""}`)
  }
  if (words > 0) {
    lines.push(
      `Length: about **${words.toLocaleString()} words**` +
        (structure.length ? ` · includes ${structure.join(", ")}` : ""),
    )
  }
  lines.push(
    "Open the **Canvas** panel to read, copy, clear, or **Save** the draft to Documents.",
  )
  return lines.join("\n\n")
}
