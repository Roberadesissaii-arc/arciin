/**
 * What to offer the reader next.
 *
 * Two kinds of thing get called a suggestion, and conflating them is what
 * produced "Go deeper" underneath a finished book.
 *
 * **Deterministic actions** come from application state and need no model. The
 * app already knows the next chapter is eight; asking a model to work that out
 * is a round trip to learn something it does not know as well as we do. These
 * are exact, instant, and correct by construction.
 *
 * **Advisory actions** are the model's judgement about this particular text —
 * "resolve the missing-prefect subplot", "the examples in chapters four to six
 * repeat". A model is the only thing that can produce those, and they are worth
 * having, but they are secondary: they never displace the action the reader
 * obviously needs.
 *
 * The engine is keyed by artifact type so a book, an essay and a set of study
 * notes each get actions that make sense for them, rather than one menu
 * stretched over everything.
 */

import type { BookProject } from "./book/types"
import { bookProgress, nextChapterNumber } from "./book/types"

export type SuggestedActionKind =
  | "book_resume"
  | "book_pause"
  | "book_stop_after"
  | "book_retry"
  | "book_review_outline"
  | "book_open_manuscript"
  | "canvas_transform"
  | "canvas_analyze"
  | "canvas_save"
  | "send_prompt"

export type SuggestedAction = {
  id: string
  label: string
  description?: string
  action: SuggestedActionKind
  /** Text to send, for the prompt-shaped actions. */
  prompt?: string
  /** Primary actions lead; secondary ones follow and may be trimmed. */
  priority: "primary" | "secondary"
}

/** What the last turn produced, which decides which menu applies. */
export type ArtifactKind =
  | "book"
  | "essay"
  | "study-notes"
  | "case-brief"
  | "document"
  | "none"

/**
 * Work out what kind of thing the draft is.
 *
 * Cheap and structural — headings and a few marker phrases. A wrong guess costs
 * a slightly-off suggestion, so this deliberately falls back to "document"
 * rather than reaching for confidence it does not have.
 */
export function detectArtifactKind(input: {
  hasBookProject?: boolean
  title?: string
  content?: string
}): ArtifactKind {
  if (input.hasBookProject) return "book"
  const text = `${input.title ?? ""}\n${(input.content ?? "").slice(0, 4000)}`
  if (!text.trim()) return "none"

  if (/\b(IRAC|holding|procedural history|case brief|appellant|respondent)\b/i.test(text)) {
    return "case-brief"
  }
  if (/\b(flashcard|study (?:guide|notes)|key terms?|revision notes?|quiz)\b/i.test(text)) {
    return "study-notes"
  }
  if (
    /^##\s*(introduction|conclusion)\b/im.test(text) ||
    /\b(thesis|argues that|in conclusion)\b/i.test(text)
  ) {
    return "essay"
  }
  return "document"
}

/* -------------------------------------------------------------------- books */

/**
 * The book menu, which changes with the run's state.
 *
 * "Continue" is never offered while it is already continuing — the single most
 * confusing thing the old fixed menu did.
 */
export function bookActions(project: BookProject): SuggestedAction[] {
  const { done, total } = bookProgress(project)
  const next = nextChapterNumber(project)
  const nextTitle = project.chapters.find((c) => c.number === next)?.title

  switch (project.status) {
    case "planning":
    case "writing":
      return [
        {
          id: "book-pause",
          label: "Pause after this chapter",
          description: `${done} of ${total} written`,
          action: "book_stop_after",
          priority: "primary",
        },
        {
          id: "book-outline",
          label: "Review outline",
          action: "book_review_outline",
          priority: "secondary",
        },
        {
          id: "book-manuscript",
          label: "Open manuscript",
          action: "book_open_manuscript",
          priority: "secondary",
        },
      ]

    case "stopping":
      return [
        {
          id: "book-resume",
          label: "Keep writing after all",
          action: "book_resume",
          priority: "primary",
        },
      ]

    case "paused":
      return [
        {
          id: "book-resume",
          label: nextTitle ? `Resume with Chapter ${next}` : "Resume writing",
          description: nextTitle,
          action: "book_resume",
          priority: "primary",
        },
        {
          id: "book-manuscript",
          label: "Review manuscript so far",
          action: "book_open_manuscript",
          priority: "secondary",
        },
        {
          id: "book-adjust",
          label: "Adjust upcoming chapters",
          action: "send_prompt",
          prompt: `/modify revise the Contents list for chapters ${next} onward`,
          priority: "secondary",
        },
      ]

    case "failed":
      return [
        {
          id: "book-retry",
          label: `Retry Chapter ${next}`,
          description: project.lastError,
          action: "book_retry",
          priority: "primary",
        },
        {
          id: "book-manuscript",
          label: "Open manuscript",
          action: "book_open_manuscript",
          priority: "secondary",
        },
      ]

    case "completed":
      return [
        {
          id: "book-polish",
          label: "Polish manuscript",
          action: "send_prompt",
          prompt: "/modify tighten the prose throughout without changing the structure",
          priority: "primary",
        },
        {
          id: "book-continuity",
          label: "Check continuity",
          action: "canvas_analyze",
          prompt:
            "Read the manuscript and list any contradictions, unresolved threads, or repeated material. Do not rewrite it.",
          priority: "primary",
        },
        {
          id: "book-synopsis",
          label: "Create synopsis",
          action: "send_prompt",
          prompt: "Write a one-page synopsis of this book.",
          priority: "secondary",
        },
        {
          id: "book-export",
          label: "Save to Documents",
          action: "canvas_save",
          priority: "secondary",
        },
      ]
  }
}

/* ---------------------------------------------------------- other artifacts */

const ARTIFACT_ACTIONS: Record<
  Exclude<ArtifactKind, "book" | "none">,
  Array<Omit<SuggestedAction, "id">>
> = {
  essay: [
    {
      label: "Strengthen the argument",
      action: "canvas_transform",
      prompt: "/modify strengthen the central argument and make the reasoning explicit",
      priority: "primary",
    },
    {
      label: "Add evidence",
      action: "canvas_transform",
      prompt: "/modify support the main claims with concrete evidence and examples",
      priority: "primary",
    },
    {
      label: "Improve the conclusion",
      action: "canvas_transform",
      prompt: "/modify rewrite the conclusion so it earns its claims",
      priority: "secondary",
    },
  ],
  "study-notes": [
    {
      label: "Quiz me on this",
      action: "send_prompt",
      prompt: "Quiz me on these notes, one question at a time. Wait for my answer before the next.",
      priority: "primary",
    },
    {
      label: "Create flashcards",
      action: "canvas_transform",
      prompt: "/modify turn these notes into question-and-answer flashcards",
      priority: "primary",
    },
    {
      label: "Explain the hardest concept",
      action: "send_prompt",
      prompt: "Which concept in these notes is hardest, and explain it plainly.",
      priority: "secondary",
    },
    {
      label: "Create a practice test",
      action: "send_prompt",
      prompt: "Write a practice test from these notes, with an answer key at the end.",
      priority: "secondary",
    },
  ],
  "case-brief": [
    {
      label: "Create an IRAC analysis",
      action: "canvas_transform",
      prompt: "/modify restructure this as an IRAC analysis",
      priority: "primary",
    },
    {
      label: "Quiz me on the holding",
      action: "send_prompt",
      prompt: "Quiz me on the holding and reasoning of this case.",
      priority: "primary",
    },
    {
      label: "Compare related cases",
      action: "send_prompt",
      prompt: "Compare this case with the leading related authorities.",
      priority: "secondary",
    },
    {
      label: "Generate exam hypotheticals",
      action: "send_prompt",
      prompt: "Write three exam hypotheticals that turn on this holding.",
      priority: "secondary",
    },
  ],
  document: [
    {
      label: "Make it shorter",
      action: "canvas_transform",
      prompt: "/modify cut this down by about a third",
      priority: "secondary",
    },
    {
      label: "Warmer tone",
      action: "canvas_transform",
      prompt: "/modify rewrite in a warmer, less formal voice",
      priority: "secondary",
    },
  ],
}

/**
 * Assemble the menu for a turn.
 *
 * Deterministic actions first, then the model's own advice, then the generic
 * artifact set only if there is still room — so a book that is mid-run shows
 * Pause and the model's continuity note, never "Make it shorter".
 */
export function buildNextActions(input: {
  bookProject?: BookProject | null
  artifact?: ArtifactKind
  /** The model's suggestions for this specific draft, if it offered any. */
  advisory?: string[]
  hasCanvasDraft?: boolean
  limit?: number
}): SuggestedAction[] {
  const limit = input.limit ?? 4
  const actions: SuggestedAction[] = []

  if (input.bookProject) {
    actions.push(...bookActions(input.bookProject))
  }

  for (const [index, text] of (input.advisory ?? []).entries()) {
    actions.push({
      id: `advisory-${index}`,
      label: text,
      action: input.hasCanvasDraft ? "canvas_transform" : "send_prompt",
      prompt: input.hasCanvasDraft ? `/modify ${text}` : text,
      priority: "secondary",
    })
  }

  const kind = input.artifact ?? "none"
  if (!input.bookProject && kind !== "none" && kind !== "book") {
    actions.push(
      ...ARTIFACT_ACTIONS[kind].map((a, index) => ({ ...a, id: `${kind}-${index}` })),
    )
  }

  if (!input.bookProject && input.hasCanvasDraft) {
    actions.push({
      id: "canvas-save",
      label: "Save to Documents",
      action: "canvas_save",
      priority: "secondary",
    })
  }

  const seen = new Set<string>()
  const ordered = [
    ...actions.filter((a) => a.priority === "primary"),
    ...actions.filter((a) => a.priority === "secondary"),
  ]
  return ordered
    .filter((a) => {
      const key = a.label.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}
