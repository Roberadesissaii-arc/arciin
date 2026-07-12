export const AI_EMOJI_USAGE_LEVELS = ["none", "low", "medium", "high"] as const
export type AiEmojiUsage = (typeof AI_EMOJI_USAGE_LEVELS)[number]

export type AiSettingsResolved = {
  agent: boolean
  autonomy: boolean
  planning: boolean
  showThinking: boolean
  emojiUsage: AiEmojiUsage
}

export const DEFAULT_AI_SETTINGS: AiSettingsResolved = {
  agent: true,
  autonomy: false,
  planning: true,
  showThinking: true,
  emojiUsage: "none",
}

export function parseAiConfig(cfg: unknown): AiSettingsResolved {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {}
  const rawEmoji = c.emojiUsage
  const emojiUsage = AI_EMOJI_USAGE_LEVELS.includes(rawEmoji as AiEmojiUsage)
    ? (rawEmoji as AiEmojiUsage)
    : DEFAULT_AI_SETTINGS.emojiUsage

  return {
    agent: Boolean(c.agent ?? DEFAULT_AI_SETTINGS.agent),
    autonomy: Boolean(c.autonomy ?? DEFAULT_AI_SETTINGS.autonomy),
    planning: Boolean(c.planning ?? DEFAULT_AI_SETTINGS.planning),
    showThinking: Boolean(c.showThinking ?? DEFAULT_AI_SETTINGS.showThinking),
    emojiUsage,
  }
}

const ARCIIN_TOOLS_SYSTEM_APPEND = `

## Arciin server tools
Tool results may already appear as role=tool messages in this chat (organize_images_library, vision_search_library, **create_library_folder**, **delete_library_folder**).
When tool results are present, you MUST summarize what the server did — folders created, files moved, matches found, folder deleted, etc.
NEVER print bracket-style fake tool lines like \`[delete_library_folder: ...]\` or \`[create_library_folder: ...]\` — they are **not executed**; use native tool_calls, then summarize real **tool** results.
NEVER tell the user you cannot create or delete individual folders when **create_library_folder** / **delete_library_folder** apply — invoke those tools (unless they explicitly asked for Postman/curl instructions only).
NEVER tell the user you cannot create folders, move files, or search the library when tool results are in context.
NEVER give manual "go to Images and drag files" instructions if organize_images_library already ran.
If vision_search_library returned displayTag, include that tag exactly once in your reply.

## Act, then report — never announce
NEVER claim an action happened or is in progress ("I've sent the request", "creating it now", "let me confirm the result") unless a role=tool result for that action is present in this conversation. Describing an action does NOT perform it — only a native tool call does.
When the user asks you to create or delete a folder and you have the details (library + name), emit the tool call in this same turn. Never reply with intent ("I'll create it now") — either call the tool or ask ONE clarifying question.
After a tool result: if it has success:true, state plainly what was done (folder name + library). If it has an error, say exactly what failed — never pretend it worked.
If the user says an action you reported did not happen, re-run the tool call — do not apologize and list files instead.

## Relevance
Answer only what the user asked. Do not attach [[ASSETS:...]] tags or show recent files on greetings or unrelated questions unless they explicitly asked to see/browse files.

## Reasoning vs final answer (thinking models)
Put planning in thinking/reasoning only — not in the user-visible answer. Never say "Now let me search…" or "I'll read the PDF…" in the final reply; execute tools and report results.
When tool results are in context (especially read_pdf_asset), summarize what you found — page numbers, chapters, and a short quote — in plain language.`

function buildEmojiAppend(level: AiEmojiUsage): string {
  switch (level) {
    case "none":
      return `

## Tone
Do not use emojis in your replies.`
    case "low":
      return `

## Tone
Use emojis sparingly (at most one per message, only when it clearly helps).`
    case "medium":
      return `

## Tone
You may use emojis occasionally where they improve readability.`
    case "high":
      return `

## Tone
You may use emojis freely where they fit the conversation.`
  }
}

/** System instructions derived from instance AI settings (appended to the chat system message). */
export function buildAiSystemAppend(settings: AiSettingsResolved): string {
  const parts: string[] = []

  if (settings.agent) {
    parts.push(ARCIIN_TOOLS_SYSTEM_APPEND)
    if (!settings.autonomy) {
      parts.push(`

## Autonomy
Server tools run only when the user clearly asks to organize or search the library. If intent is ambiguous, ask before acting.`)
    }
  } else {
    parts.push(`

## Arciin agent
Server-side agent tools are disabled for this instance. Do not claim you organized the library, moved files, or ran vision search. Provide guidance only.`)
  }

  if (settings.planning) {
    parts.push(`

## Planning
For complex or multi-step requests, briefly outline your plan before acting or answering.`)
  }

  parts.push(buildEmojiAppend(settings.emojiUsage))

  return parts.join("")
}

export type AiChatToolBehavior = Pick<AiSettingsResolved, "agent" | "autonomy">
