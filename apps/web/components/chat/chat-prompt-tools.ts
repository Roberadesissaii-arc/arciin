import type { ChatPromptToolId } from "@/components/chat/chat-prompt-box"

/**
 * System-side directives for composer tool chips.
 * Kept out of the visible user bubble — only sent on the system message.
 * These must create *observable* behavior differences when toggled.
 */
export function buildPromptToolsSystemAppend(tools: ChatPromptToolId[]): string {
  if (tools.length === 0) {
    return (
      "\n\n--- Composer tool modes ---\n" +
      "[Default] No special tool modes. Answer normally. Do not attach vision pixels unless the user clearly asks about an image. " +
      "Do not open full PDF/code bodies unless the user asks to read/summarize a specific file.\n---"
    )
  }

  const lines: string[] = [
    "\n\n--- Composer tool modes (user toggled for this turn) ---",
  ]

  if (tools.includes("library")) {
    lines.push(
      "[Library ON — REQUIRED] You MUST use Arciin library tools / live context for this turn. " +
        "Search, list, organize, and answer from real folders and libraries. " +
        "When listing media, include the appropriate [[ASSETS:…]] or [[ASSET_LIST:…]] tags. " +
        "Never invent library contents. Prefer tools over generic advice.",
    )
  }
  if (tools.includes("files")) {
    lines.push(
      "[Files ON — REQUIRED] Focus on files already stored on this instance. " +
        "When the user wants a summary, explanation, or contents of a document/PDF/code file, " +
        "you MUST call read_pdf_asset or read_text_asset and then answer from the tool result. " +
        "Never stop after saying you will open a file — complete the answer using tool output. " +
        "If they named one file, answer about that file only — do not list the whole library " +
        "and do not emit [[ASSET_LIST:…]] / [[ASSETS:…]] unless they explicitly asked to list files.",
    )
  }
  if (tools.includes("vision")) {
    lines.push(
      "[Vision ON — REQUIRED] Image pixels may be attached to the latest user message. " +
        "Describe them accurately. If no pixels are attached, say so and ask the user to enable Vision with a vision model " +
        "or keep an image in Images. Never invent visual details.",
    )
  }
  if (tools.includes("thinking")) {
    lines.push(
      "[Think ON — REQUIRED] Reason step-by-step in your thinking/reasoning channel before the final answer. " +
        "Keep the final user-facing answer clear and complete.",
    )
  } else {
    lines.push(
      "[Think OFF] Prefer a direct final answer. Skip lengthy chain-of-thought preambles in the visible reply.",
    )
  }

  lines.push("---")
  return lines.join("\n")
}

export function promptToolsForceVision(tools: ChatPromptToolId[]): boolean {
  return tools.includes("vision")
}

export function promptToolsForceThinking(tools: ChatPromptToolId[]): boolean {
  return tools.includes("thinking")
}

export function promptToolsForceFiles(tools: ChatPromptToolId[]): boolean {
  return tools.includes("files")
}

export function promptToolsForceLibrary(tools: ChatPromptToolId[]): boolean {
  return tools.includes("library")
}
