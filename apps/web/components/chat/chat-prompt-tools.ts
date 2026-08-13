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
        "When a file is attached or named, Arciin loads its text for you — use that source text. " +
        "Never stop after saying you will open a file. Never narrate tool calls. " +
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
  if (tools.includes("canvas")) {
    lines.push(
      "[Canvas ON — finished document body only] The user enabled Canvas for a long-form deliverable " +
        "(essay, documentation, exam, quiz, study questions, outline, story, report, etc.). " +
        "If the user message includes [USER ATTACHED FILE(S) — REQUIRED CONTEXT], base the document on THAT file only — " +
        "never ask which book. Use the tool result text when available; do not invent chapters. " +
        "Your ENTIRE assistant message must be ONLY the finished document — nothing else. " +
        "Never print tool_call XML, function JSON, or <tool_call> blocks.\n\n" +
        "## Markdown style rules (important for Canvas rendering)\n" +
        "- Use **# Title** once at the top, then **## Section** and **### Subsection** only (max 3 levels).\n" +
        "- Do **not** use #### or deeper headings — they render poorly.\n" +
        "- Use **bold** for emphasis, not bare hashtags.\n" +
        "- Use normal Markdown lists (- item or 1. item). Blank lines between paragraphs.\n" +
        "- Use fenced ```code``` **only for real programming code**. Never wrap ordinary paragraphs, " +
        "numbered questions, or bullet lists in code fences — that makes them look like a terminal.\n" +
        "- NEVER draw diagrams out of characters. No ASCII art, no box-drawing, no arrows made " +
        "from dashes, no figures built from | / \\ = or _. Canvas is proportional text, so they " +
        "arrive as a column of broken lines — this is the single worst-looking thing the panel " +
        "can produce.\n" +
        "- When a picture would help and you cannot draw one, use a table of parts and their jobs, " +
        "or an inline flow written as prose: Dendrites -> cell body -> axon hillock -> axon -> " +
        "terminals. Both read correctly at any width.\n\n" +
        "## Pick the format from the user request\n" +
        "### A) Essay / paper / report\n" +
        "1. # Title\n2. Optional Author / Course / Date\n3. ## Introduction (thesis)\n" +
        "4. ## Body sections (2–4)\n5. ## Conclusion\n6. ## References\n" +
        "Aim ~800–1500 words unless they asked short.\n\n" +
        "### B) Documentation / manual / how-to (\"documentation\", \"docs\", \"manual\", \"guide\")\n" +
        "1. # Document title\n2. ## Overview\n3. ## Prerequisites (if any)\n" +
        "4. ## Sections for each topic/feature with ### subheads\n" +
        "5. Numbered steps for procedures; bullets for options\n" +
        "6. ## Notes / Warnings where useful\n7. ## References (source book)\n" +
        "Write like product documentation: clear, scannable, professional — not a code dump.\n\n" +
        "### C) Outline\n" +
        "# Title then hierarchical ## / ### with bullets (no code fences).\n\n" +
        "### D) Exam / quiz / practice test\n" +
        "Title, instructions, Section A MCQ, Section B short answer, Section C long questions, optional Answer key.\n\n" +
        "### E) Study / discussion questions\n" +
        "Title, numbered questions by theme, optional suggested answers.\n\n" +
        "### F) Story\n" +
        "Title, narrative paragraphs (dialogue if needed). Minimal headings.\n\n" +
        "STRICTLY FORBIDDEN: preambles, process talk (\"I need to read the PDF…\", \"[Attempting to read PDF: …]\"), " +
        "tool XML/JSON, listing the library, asking which book, wrapping prose in ``` fences, " +
        "[[ASSET_LIST:…]] / [[ASSETS:…]] tags. Start with the document title heading immediately.",
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

export function promptToolsForceCanvas(tools: ChatPromptToolId[]): boolean {
  return tools.includes("canvas")
}

export function promptToolsForceFiles(tools: ChatPromptToolId[]): boolean {
  return tools.includes("files")
}

export function promptToolsForceLibrary(tools: ChatPromptToolId[]): boolean {
  return tools.includes("library")
}
