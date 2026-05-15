"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUp, ChevronDown, Clock, Copy, File, Info, Loader2, MessageSquare,
  Plus, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Trash2, User, X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { getAssets, getAssetsByIds } from "@/lib/api/assets"
import { getAvailableModels, getOllamaModelShow } from "@/lib/api/models"
import { fetchApi } from "@/lib/api/client"
import {
  createChatConversation,
  deleteChatConversation,
  getChatConversation,
  getChatConversations,
  getChatInstanceContext,
  getChatStreamPostUrl,
  getChatVisionRecent,
  saveChatMessages,
  setChatMessageFeedback,
  updateChatMessage,
  type ChatConversationSummary,
  type ChatInstanceContext,
  type ChatMessageFeedbackRating,
} from "@/lib/api/chat"
import { getAiSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { isOllamaProvider, ollamaCapabilitiesIncludeVision } from "@/lib/ollama-providers"
import type { OllamaModelShowData } from "@/lib/types/models"

// ── Types ──────────────────────────────────────────────────────────────────────

type ChatProfile = {
  id: string
  provider: string
  displayName: string
  defaultModel: string | null
  isDefault: boolean
}

type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number }

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  thinking?: string
  pending?: boolean
  usage?: TokenUsage
  /** Persisted row id (same as id when loaded from history). */
  dbId?: string
  feedback?: ChatMessageFeedbackRating | null
}

/** Opening/closing tags for inline reasoning — may appear mid-stream, not only at offset 0. */
const REASONING_OPEN_TAG =
  /<(?:think(?:ing)?|redacted_reasoning|redacted_think)>\s*/i
const REASONING_CLOSE_TAG =
  /<\/(?:think(?:ing)?|redacted_reasoning|redacted_think)>/i

function parseThinking(raw: string): { thinking: string; response: string; inThink: boolean } {
  const openMatch = raw.match(REASONING_OPEN_TAG)
  if (!openMatch || openMatch.index === undefined) {
    return { thinking: "", response: raw, inThink: false }
  }
  const afterOpen = raw.slice(openMatch.index + openMatch[0].length)
  const closeMatch = afterOpen.match(REASONING_CLOSE_TAG)
  if (!closeMatch || closeMatch.index === undefined) {
    return {
      thinking: afterOpen,
      response: raw.slice(0, openMatch.index),
      inThink: true,
    }
  }
  const thinking = afterOpen.slice(0, closeMatch.index).trim()
  const afterClose = afterOpen.slice(closeMatch.index + closeMatch[0].length)
  const response = (raw.slice(0, openMatch.index) + afterClose).trim()
  return { thinking, response, inThink: false }
}

/**
 * Qwen / Ollama TTY style: model streams plain text starting with `Thinking...` then `...done thinking.`
 * before the user-visible answer. Split so the Thinking panel updates on every chunk.
 */
function splitPlainTextReasoningBlock(accumulated: string): { thinking: string; answer: string; matched: boolean } {
  const lead = accumulated.replace(/^\uFEFF/, "")
  const firstLine = (lead.split(/\r?\n/, 1)[0] ?? "").trimEnd()
  const startsReasoning =
    /^Thinking\b/i.test(firstLine) ||
    /^Thinking\s+process\s*:/im.test(lead.trimStart())
  if (!startsReasoning) {
    return { thinking: "", answer: accumulated, matched: false }
  }

  const endPatterns: RegExp[] = [
    /\n\s*\.{3}\s*done\s+thinking\.?\s*(?:\r?\n)+/i,
    /\n\s*\.{2}\s*done\s+thinking\.?\s*(?:\r?\n)+/i,
    /\n\s*done\s+thinking\.?\s*(?:\r?\n)+/i,
  ]
  for (const re of endPatterns) {
    const m = re.exec(lead)
    if (m?.index !== undefined) {
      return {
        thinking: lead.slice(0, m.index + m[0].length).trimEnd(),
        answer: lead.slice(m.index + m[0].length).trimStart(),
        matched: true,
      }
    }
  }
  return { thinking: lead, answer: "", matched: true }
}

function deriveStreamingThinkingAndAnswer(
  accumulated: string,
  dedicatedThinking: string,
  showReasoningPanel: boolean,
): { thinking: string; answer: string; inReasoningBlock: boolean } {
  if (dedicatedThinking) {
    return {
      thinking: showReasoningPanel ? dedicatedThinking : "",
      answer: accumulated,
      inReasoningBlock: false,
    }
  }
  const plain = splitPlainTextReasoningBlock(accumulated)
  if (plain.matched) {
    if (showReasoningPanel) {
      return {
        thinking: plain.thinking,
        answer: plain.answer,
        inReasoningBlock: !plain.answer.trim(),
      }
    }
    return {
      thinking: "",
      answer: plain.answer,
      inReasoningBlock: false,
    }
  }
  const tagged = parseThinking(accumulated)
  if (tagged.thinking || tagged.inThink) {
    if (showReasoningPanel) {
      return {
        thinking: tagged.thinking,
        answer: tagged.response,
        inReasoningBlock: tagged.inThink,
      }
    }
    return {
      thinking: "",
      answer: tagged.response,
      inReasoningBlock: false,
    }
  }
  return { thinking: "", answer: accumulated, inReasoningBlock: false }
}

/**
 * When Ollama streams reasoning in `thinking` but leaves `content` empty, promote thinking
 * into the visible answer so the main bubble is not permanently hidden.
 */
function resolveFinalAssistantMessage(
  accumulated: string,
  thinkingAccum: string,
  showReasoningPanel: boolean,
  reasoningUiEnabled: boolean,
): { content: string; thinking: string | undefined } {
  const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showReasoningPanel)
  let content = derived.answer.trim()
  let thinking =
    reasoningUiEnabled && (derived.thinking.length > 0 || derived.inReasoningBlock)
      ? derived.thinking
      : undefined

  if (!content && thinking?.trim()) {
    content = thinking.trim()
    thinking = undefined
  } else if (!content) {
    content = accumulated.trim()
  }

  if (content && thinking && content.trim() === thinking.trim()) {
    thinking = undefined
  }

  return { content, thinking }
}

function finalizeAssistantContent(content: string, userText: string): string {
  return stripUnrequestedAssetTags(content, userText)
}

const PROVIDER_MODELS: Record<string, string[]> = {
  openai:     ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "gpt-4-turbo"],
  anthropic:  ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  gemini:     ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  deepseek:   ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  grok:       ["grok-2", "grok-2-mini", "grok-3"],
  meta:       ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "meta-llama/Llama-4-Scout-17B-16E-Instruct"],
  qwen:       ["qwen-max", "qwen-plus", "qwen-turbo"],
  ollama:         [],
  "ollama-local": [],
  "ollama-cloud": [],
  elevenlabs: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
}

const SYSTEM_INSTRUCTION_KEY = "arciin:system-instruction"
/** Persist chat model picker across reloads (profile id + model name). */
const CHAT_SELECTED_PROFILE_ID_KEY = "arciin:chat:selected-profile-id"
const CHAT_SELECTED_MODEL_KEY = "arciin:chat:selected-model"

const ASSET_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

export const ARCIIN_DEFAULT_SYSTEM_INSTRUCTION = `You are the AI assistant built into Arciin — a self-hosted private file and media management platform.

## Navigation — always use markdown links when directing users somewhere

Exact paths (use these as clickable links, e.g. [Settings → General](/settings)):
- Dashboard: [Dashboard](/)
- Libraries: [Videos](/videos), [Images](/images), [Music](/music), [Documents](/documents), [All Files](/files)
- Activity feed: [Activity](/activity)
- Background jobs: [Jobs](/jobs)
- API keys: [API Keys](/api-keys)
- Webhooks: [Webhooks](/webhooks)
- Events stream: [Events](/events)
- Models / AI config: [Models](/models)
- Settings: [Settings](/settings)
- Settings – Access Control: [Settings → Access Control](/settings?tab=access-control)
- Settings – API Protection: [Settings → API Protection](/settings?tab=api-protection)
- Settings – AI (Planning): [Settings → Planning](/settings?tab=ai)
- Settings – AI Security: [Settings → AI Security](/settings?tab=ai-security)
- Developer panel: [Developer](/developer)
- Developer – WebSockets/remote access: [Developer → WebSockets](/developer/web-sockets)
- Integrations: [Integrations](/integrations)

## Rules
- When directing the user to a section, ALWAYS include the markdown link so they can click to navigate.
- When listing steps, number them and include a link on the relevant step.
- Be concise and precise. Avoid vague directions like "go to Settings" without the link.
- The instance context block below is live data — use it to answer questions about file counts, storage, and library contents accurately.
- You do not have pixels, audio waveforms, or document text unless **this request** includes attached image bytes (vision). Otherwise you only have aggregate counts, filenames, and sizes from the context block — not the file contents themselves.
- When a **[Vision]** note appears in the system context for this turn, image pixels are attached to the user's message — describe what you see. Do not say you cannot view images in that case.

## Answer only what was asked
- Reply to the user's **actual** message first. Do not pad greetings or small talk with library previews, file cards, or [[ASSETS:...]] tags they did not request.
- Greetings (hello, hi, hey, thanks, etc.) → brief friendly reply only. No asset tags, no "here are your recent images", no unsolicited organize/search tips unless they ask what you can do.
- Count or location questions ("how many videos?", "where are my files?") → answer with numbers and/or a markdown link to the right library. Use [[ASSETS:...]] only if they explicitly asked to **see** or **browse** files (e.g. "show me my videos").
- You may offer one short optional sentence of help (e.g. "Ask me to show your images anytime.") — never attach asset cards unless they asked to see files.
- Having Images/Videos in the instance context does **not** mean the user wants thumbnails on this turn.

## Showing assets inline
Only when the user **explicitly** asks to see, show, browse, list, or view their files/media (images, videos, music, documents). Structure your response in three parts:
1. A short opening sentence (1–2 sentences, use live counts from the context block).
2. The asset tag on its own line — the tag renders visual cards automatically, so **do NOT list filenames or file names in your text**.
3. A short follow-up: a helpful observation, tip, or offer (1–2 sentences).

Tag syntax — you can optionally limit the number of cards shown by appending :N:
- [[ASSETS:images]] — shows up to 9 recent images
- [[ASSETS:images:1]] — shows only the most recent image
- [[ASSETS:videos]] — shows up to 9 recent videos
- [[ASSETS:videos:1]] — shows only the most recent video
- [[ASSETS:music]] — shows recent music
- [[ASSETS:documents]] — shows recent documents
- [[ASSETS:all]] — shows all recent files

Limit rules — apply these strictly:
- Singular phrasing ("a video", "one video", "the video", "I need one", "give me one", "the latest", "the most recent", "the first one") → ALWAYS use :1
- "a few" or "some" → use :3
- "all", "everything", "list" → use default (no limit)
- When in doubt about quantity, default to :1 rather than showing multiple.

Example — user asks "show me my videos":
"Here are your most recently uploaded videos — you have 5 in total.

[[ASSETS:videos]]

Let me know if you'd like to organize these into folders or find something specific."

Example — user asks "show me a video" / "I need one" / "the latest video" / "open a video":
"Here is your most recently uploaded video.

[[ASSETS:videos:1]]

Let me know if you need a different one or want to see all of them."

Only include one asset tag per response, and **only** when the user explicitly asked to see files in this message. Never list filenames as plain text when using a tag. Never use asset tags on greetings or unrelated questions.

## Library actions (server tools)
Arciin runs **vision_search_library** and **organize_images_library** on the server when you request find/organize workflows.
When tool results appear in the conversation, summarize them — never tell the user to create folders manually in the UI.
After **organize_images_library**, report folders created and files moved; link to [Images](/images).
After **vision_search_library**, use **displayTag** exactly once if provided.
Never use [[ASSETS:images]] when displayTag or specific IDs were returned.`

// ── Markdown renderer ──────────────────────────────────────────────────────────

function parseInline(text: string): React.ReactNode {
  // Matches: **bold**, *italic*, `code`, [label](url)
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(<strong key={k++} className="font-semibold text-foreground">{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(<em key={k++}>{m[2]}</em>)
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={k++} className="rounded bg-zinc-100 px-[5px] py-px font-mono text-[11px] text-zinc-700">
          {m[3]}
        </code>
      )
    } else if (m[4] !== undefined && m[5] !== undefined) {
      const href = m[5]
      const isInternal = href.startsWith("/")
      nodes.push(
        <a
          key={k++}
          href={href}
          target={isInternal ? "_self" : "_blank"}
          rel={isInternal ? undefined : "noopener noreferrer"}
          className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium text-primary underline-offset-2 transition-colors hover:bg-primary/20 hover:underline"
        >
          {m[4]}
        </a>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length === 1 ? nodes[0] : nodes
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n")
  const nodes: React.ReactNode[] = []
  const listItems: { text: string; ordered: boolean }[] = []
  const tableLines: string[] = []
  let inCode = false
  const codeLines: string[] = []
  let k = 0

  function flushList() {
    if (!listItems.length) return
    const ordered = listItems[0].ordered
    const items = listItems.splice(0)
    nodes.push(
      ordered ? (
        <ol key={k++} className="my-1 list-decimal space-y-0.5 pl-5 text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="pl-0.5 leading-relaxed">{parseInline(it.text)}</li>
          ))}
        </ol>
      ) : (
        <ul key={k++} className="my-1 space-y-0.5 pl-1 text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 leading-relaxed">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-zinc-400" />
              <span>{parseInline(it.text)}</span>
            </li>
          ))}
        </ul>
      )
    )
  }

  function flushTable() {
    if (!tableLines.length) return
    const rows = tableLines.splice(0)

    const parseRow = (line: string) =>
      line.split("|").slice(1, -1).map((c) => c.trim())

    const isSep = (line: string) =>
      line.replace(/\s/g, "").replace(/[|:\-]/g, "").length === 0 && line.includes("-")

    const sepIdx = rows.findIndex(isSep)
    const headerCells = rows[0] ? parseRow(rows[0]) : []
    const bodyRows = rows
      .filter((_, i) => i !== 0 && (sepIdx === -1 || i !== sepIdx))
      .map(parseRow)
      .filter((r) => r.length > 0)

    nodes.push(
      <div key={k++} className="my-2 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-muted/50">
              {headerCells.map((cell, ci) => (
                <th
                  key={ci}
                  className="border-b border-border px-3 py-2 text-left font-semibold text-foreground"
                >
                  {parseInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 1 ? "bg-muted/20" : ""}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border-b border-border/50 px-3 py-2 text-foreground last:border-0"
                  >
                    {parseInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function flushAll() {
    flushList()
    flushTable()
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode) {
        flushAll()
        inCode = true
        codeLines.length = 0
      } else {
        nodes.push(
          <pre key={k++} className="my-2 overflow-x-auto rounded-xl bg-zinc-950 px-4 py-3 text-[12px] leading-relaxed text-zinc-100">
            <code>{codeLines.join("\n")}</code>
          </pre>
        )
        inCode = false
      }
      continue
    }

    if (inCode) { codeLines.push(line); continue }

    // [[ASSETS:ids:id1,id2]] — vision search results
    const idsMatch = line.match(/\[\[ASSETS:ids:([^\]]+)\]\]/)
    if (idsMatch) {
      flushAll()
      const before = line.slice(0, idsMatch.index!).trim()
      const after  = line.slice(idsMatch.index! + idsMatch[0].length).trim()
      const ids = idsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      if (before) nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(before)}</p>)
      nodes.push(<InlineAssetBlockByIds key={k++} assetIds={ids} />)
      if (after)  nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(after)}</p>)
      continue
    }

    // Inline asset block tag — [[ASSETS:type]] or [[ASSETS:type:N]]
    const assetMatch = line.match(/\[\[ASSETS:([a-z]+)(?::(\d+))?\]\]/)
    if (assetMatch) {
      flushAll()
      const before = line.slice(0, assetMatch.index!).trim()
      const after  = line.slice(assetMatch.index! + assetMatch[0].length).trim()
      const limit  = assetMatch[2] ? parseInt(assetMatch[2], 10) : 9
      if (before) nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(before)}</p>)
      nodes.push(<InlineAssetBlock key={k++} mediaType={assetMatch[1]} limit={limit} />)
      if (after)  nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(after)}</p>)
      continue
    }

    // Table line
    if (line.trimStart().startsWith("|")) {
      flushList()
      tableLines.push(line)
      continue
    } else {
      flushTable()
    }

    const h2 = line.match(/^#{1,2}\s+(.+)/)
    const h3 = !h2 && line.match(/^###\s+(.+)/)
    const hr = /^---+$/.test(line.trim())
    const ul = line.match(/^[-*]\s+(.+)/)
    const ol = line.match(/^\d+\.\s+(.+)/)

    if (h2) {
      flushList()
      nodes.push(<p key={k++} className="mb-0.5 mt-3 text-[13px] font-bold text-foreground first:mt-0">{parseInline(h2[1])}</p>)
    } else if (h3) {
      flushList()
      nodes.push(<p key={k++} className="mb-0.5 mt-2 text-[13px] font-semibold text-foreground">{parseInline(h3[1])}</p>)
    } else if (hr) {
      flushList()
      nodes.push(<hr key={k++} className="my-2 border-zinc-200" />)
    } else if (ul) {
      if (listItems[0]?.ordered) flushList()
      listItems.push({ text: ul[1], ordered: false })
    } else if (ol) {
      if (listItems[0] && !listItems[0].ordered) flushList()
      listItems.push({ text: ol[1], ordered: true })
    } else if (line.trim() === "") {
      flushList()
    } else {
      flushList()
      nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(line)}</p>)
    }
  }

  if (inCode && codeLines.length) {
    nodes.push(
      <pre key={k++} className="my-2 overflow-x-auto rounded-xl bg-zinc-950 px-4 py-3 text-[12px] leading-relaxed text-zinc-100">
        <code>{codeLines.join("\n")}</code>
      </pre>
    )
  }
  flushAll()

  return <div className="space-y-[3px]">{nodes}</div>
}

// ── Ollama dynamic model list (used inside ModelPicker) ───────────────────────

function OllamaProfileSection({
  profile,
  selectedProfile,
  selectedModel,
  onSelect,
}: {
  profile: ChatProfile
  selectedProfile: ChatProfile | null
  selectedModel: string
  onSelect: (model: string) => void
}) {
  const q = useQuery({
    queryKey: queryKeys.availableModels(profile.id),
    queryFn: ({ signal }) => getAvailableModels(profile.id, signal),
    staleTime: 60_000,
    retry: false,
  })

  const models = q.data ?? (profile.defaultModel ? [profile.defaultModel] : [])

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{profile.displayName}</span>
        {profile.isDefault && (
          <span className="rounded bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
            Default
          </span>
        )}
      </div>
      {q.isLoading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Fetching models…
        </div>
      ) : q.isError || models.length === 0 ? (
        <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
          {q.isError
            ? "Could not reach Ollama — is it running?"
            : "No models found. Run ollama pull first."}
        </div>
      ) : (
        models.map((model) => {
          const active =
            selectedProfile?.id === profile.id &&
            (selectedModel === model || (!selectedModel && model === profile.defaultModel))
          return (
            <button
              key={model}
              type="button"
              onClick={() => onSelect(model)}
              className={cn(
                "flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left font-mono text-[12px] last:border-0 transition-colors",
                active ? "bg-primary/[0.07] text-primary" : "text-foreground hover:bg-muted/50",
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-zinc-300")} />
              <span className="flex-1 truncate">{model}</span>
              {active && (
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-primary/60">active</span>
              )}
            </button>
          )
        })
      )}
    </>
  )
}

function OllamaModelInfoHover({
  loading,
  data,
}: {
  loading: boolean
  data: OllamaModelShowData | undefined
}) {
  const caps = data?.capabilities ?? []
  const d = data?.details
  const paramLines = (data?.parameters ?? "").split("\n").filter(Boolean).slice(0, 8).join("\n")

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="ml-0.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title="Model details (Ollama)"
          aria-label="Model details"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Info className="size-3.5" />}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-2.5 text-[11px]" align="start" side="top">
        {loading && !data ? (
          <p className="text-muted-foreground">Loading model metadata…</p>
        ) : !data ? (
          <p className="text-muted-foreground">No metadata yet.</p>
        ) : (
          <>
            {caps.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {caps.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
            {(d?.parameter_size || d?.quantization_level || d?.format) && (
              <div className="space-y-0.5 text-muted-foreground">
                {d.parameter_size && <p><span className="text-foreground/80">Size</span> · {d.parameter_size}</p>}
                {d.quantization_level && <p><span className="text-foreground/80">Quant</span> · {d.quantization_level}</p>}
                {d.format && <p><span className="text-foreground/80">Format</span> · {d.format}</p>}
              </div>
            )}
            {data.modified_at && (
              <p className="text-muted-foreground/80">
                <span className="text-foreground/80">Modified</span> · {data.modified_at}
              </p>
            )}
            {paramLines && (
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground scrollbar-hide">
                {paramLines}
              </pre>
            )}
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

// ── Model picker ───────────────────────────────────────────────────────────────

function ModelPicker({
  profiles,
  selectedProfile,
  selectedModel,
  onChange,
  ollamaShow,
  ollamaShowLoading,
}: {
  profiles: ChatProfile[]
  selectedProfile: ChatProfile | null
  selectedModel: string
  onChange: (profile: ChatProfile, model: string) => void
  ollamaShow?: OllamaModelShowData
  ollamaShowLoading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const displayLabel = selectedModel || selectedProfile?.defaultModel || selectedProfile?.displayName || "Pick a model"
  const showOllamaInfo =
    Boolean(selectedProfile && isOllamaProvider(selectedProfile.provider) && (selectedModel || selectedProfile?.defaultModel))

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-l-2xl px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <Sparkles className="size-3.5 text-primary" />
          <span className="max-w-[160px] truncate font-mono">{displayLabel}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
        {showOllamaInfo && (
          <OllamaModelInfoHover loading={Boolean(ollamaShowLoading)} data={ollamaShow} />
        )}
      </div>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 max-h-80 w-72 overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-card shadow-lg">
          {profiles.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
              No models connected.{" "}
              <Link href="/models" className="text-primary underline-offset-4 hover:underline">Configure models</Link>
            </div>
          ) : (
            profiles.map((profile) => {
              if (profile.provider === "ollama" || profile.provider === "ollama-local" || profile.provider === "ollama-cloud") {
                return (
                  <div key={profile.id}>
                    <OllamaProfileSection
                      profile={profile}
                      selectedProfile={selectedProfile}
                      selectedModel={selectedModel}
                      onSelect={(model) => { onChange(profile, model); setOpen(false) }}
                    />
                  </div>
                )
              }

              const catalogueModels = PROVIDER_MODELS[profile.provider] ?? []
              const savedDefault = profile.defaultModel
              const models = savedDefault && !catalogueModels.includes(savedDefault)
                ? [savedDefault, ...catalogueModels]
                : catalogueModels.length > 0
                  ? catalogueModels
                  : savedDefault ? [savedDefault] : []

              return (
                <div key={profile.id}>
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{profile.displayName}</span>
                    {profile.isDefault && (
                      <span className="rounded bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                        Default
                      </span>
                    )}
                  </div>
                  {models.map((model) => {
                    const active = selectedProfile?.id === profile.id && (selectedModel === model || (!selectedModel && model === savedDefault))
                    return (
                      <button
                        key={model}
                        type="button"
                        onClick={() => { onChange(profile, model); setOpen(false) }}
                        className={cn(
                          "flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left font-mono text-[12px] last:border-0 transition-colors",
                          active ? "bg-primary/[0.07] text-primary" : "text-foreground hover:bg-muted/50",
                        )}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-zinc-300")} />
                        <span className="flex-1 truncate">{model}</span>
                        {active && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-primary/60">active</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── Thinking block ─────────────────────────────────────────────────────────────

function ThinkingBlock({ content, live }: { content: string; live: boolean }) {
  const [expanded, setExpanded] = useState(true)
  const [prevLive, setPrevLive] = useState(live)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** If true, new tokens keep the view pinned to the bottom; false after user scrolls up to read. */
  const stickToBottomRef = useRef(true)

  // React "adjusting state during render": auto-expand when live starts.
  if (live && !prevLive) {
    setPrevLive(true)
    setExpanded(true)
  } else if (!live && prevLive) {
    setPrevLive(false)
  }

  // Reset scroll-pin ref outside of render (in a layout effect) so the ref write is safe.
  useEffect(() => {
    if (live) stickToBottomRef.current = true
  }, [live])

  const charCount = content.length
  const showBody = expanded && (content.length > 0 || live)

  function onScrollBody() {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = gap < 72
  }

  useLayoutEffect(() => {
    if (!showBody) return
    const el = scrollRef.current
    if (!el) return
    if (!live && !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [content, live, showBody])

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/50 bg-muted/20 text-[12px]">
      <button
        type="button"
        onClick={() => { setExpanded((v) => !v) }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {live ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary/70" />
        ) : (
          <Sparkles className="size-3 shrink-0 text-primary/40" />
        )}
        <span className="flex-1 text-[11px] font-medium text-muted-foreground">
          {live ? (
            <>
              Reasoning trace
              {charCount > 0 ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground/70">· {charCount.toLocaleString()} chars</span>
              ) : null}
            </>
          ) : (
            "Reasoning"
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {showBody && (
        <div className="border-t border-border/30 px-3 py-2.5">
          <div
            ref={scrollRef}
            onScroll={onScrollBody}
            className="max-h-[min(40vh,320px)] overflow-y-auto text-[11px] leading-relaxed text-muted-foreground/80 scrollbar-hide"
          >
            {content ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : live ? (
              <p className="italic text-muted-foreground/60">Waiting for reasoning trace…</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}


/** True when the assistant bubble should show prose and/or asset cards. */
function hasVisibleAssistantAnswer(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  const proseOnly = trimmed.replace(/\[\[ASSETS:[^\]]+\]\]/gi, "").trim()
  if (proseOnly.length > 0) return true
  return /\[\[ASSETS:/i.test(trimmed)
}

/** Database-backed message id (after save or when loaded from history). */
function messagePersistId(msg: Message): string | null {
  if (msg.dbId) return msg.dbId
  if (msg.role === "assistant" && /^c[a-z0-9]{20,}$/i.test(msg.id)) return msg.id
  return null
}

// ── Message actions ────────────────────────────────────────────────────────────

function MessageActions({
  content,
  usage,
  feedback,
  canRegenerate,
  onRegenerate,
  onFeedback,
}: {
  content: string
  usage?: TokenUsage
  feedback?: ChatMessageFeedbackRating | null
  canRegenerate: boolean
  onRegenerate?: () => void
  onFeedback: (rating: ChatMessageFeedbackRating | null) => void
}) {
  const actionBtn =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Could not copy")
    }
  }

  return (
    <div className="mt-1.5 flex items-center justify-between gap-3 px-0.5">
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={cn(actionBtn, feedback === "LIKE" && "text-primary")}
          title="Good response"
          onClick={() => onFeedback(feedback === "LIKE" ? null : "LIKE")}
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(actionBtn, feedback === "DISLIKE" && "text-red-500")}
          title="Poor response"
          onClick={() => onFeedback(feedback === "DISLIKE" ? null : "DISLIKE")}
        >
          <ThumbsDown className="size-3.5" />
        </button>
        {canRegenerate && onRegenerate ? (
          <button type="button" className={actionBtn} title="Regenerate" onClick={onRegenerate}>
            <RotateCcw className="size-3.5" />
          </button>
        ) : null}
        <button type="button" className={actionBtn} title="Copy" onClick={() => void handleCopy()}>
          <Copy className="size-3.5" />
        </button>
      </div>
      {usage ? (
        <div className="flex min-w-0 items-center justify-end gap-1.5 font-mono text-[10px] text-zinc-400">
          <span title="Input tokens">{usage.inputTokens.toLocaleString()} in</span>
          <span className="text-zinc-600">·</span>
          <span title="Output tokens">{usage.outputTokens.toLocaleString()} out</span>
          <span className="text-zinc-600">·</span>
          <span title="Total tokens" className="text-zinc-500">
            {usage.totalTokens.toLocaleString()} total
          </span>
        </div>
      ) : null}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isLive = false,
  reasoningUiEnabled = false,
  isStreaming = false,
  canRegenerate = false,
  onRegenerate,
  onFeedback,
}: {
  msg: Message
  isLive?: boolean
  reasoningUiEnabled?: boolean
  isStreaming?: boolean
  canRegenerate?: boolean
  onRegenerate?: () => void
  onFeedback?: (rating: ChatMessageFeedbackRating | null) => void
}) {
  const isUser = msg.role === "user"
  const hasThinkingText = Boolean((msg.thinking ?? "").length > 0)
  const showThinkingRow =
    !isUser && reasoningUiEnabled && (hasThinkingText || isStreaming)
  const liveThinking = Boolean(!isUser && reasoningUiEnabled && isStreaming)

  const hasVisibleAnswer = hasVisibleAssistantAnswer(msg.content ?? "")

  /**
   * With reasoning enabled: only show the answer card once there is real reply text (or asset tags).
   * Avoids an empty bordered box under the thinking panel while tools/stream are in progress.
   */
  const hideMainAnswerBubble =
    !isUser &&
    !hasVisibleAnswer &&
    reasoningUiEnabled &&
    (hasThinkingText || isStreaming || Boolean(msg.pending))

  const showNeutralGenerating =
    !isUser &&
    !reasoningUiEnabled &&
    isStreaming &&
    !hasVisibleAnswer

  const showComposingInBubble =
    !hideMainAnswerBubble &&
    !showNeutralGenerating &&
    ((msg.pending && !hasVisibleAnswer && !hasThinkingText && !isStreaming) ||
      (isStreaming && !hasVisibleAnswer && !hasThinkingText && !showThinkingRow))

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary text-white" : "border border-border bg-muted text-primary"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      <div className={isUser ? "max-w-[78%]" : "max-w-[88%]"}>
        {showThinkingRow && (
          <ThinkingBlock content={msg.thinking ?? ""} live={liveThinking} />
        )}

        {!hideMainAnswerBubble && (
        <div
          className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
            isUser
              ? "rounded-tr-sm bg-primary text-white"
              : "rounded-tl-sm border border-border bg-card text-foreground"
          }`}
        >
          {showNeutralGenerating ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Generating…
            </span>
          ) : showComposingInBubble ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Working on it…
            </span>
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : isLive ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            <MarkdownContent content={msg.content} />
          )}
        </div>
        )}

        {!isUser && !msg.pending && !isStreaming && hasVisibleAnswer && onFeedback && (
          <MessageActions
            content={msg.content}
            usage={msg.usage}
            feedback={msg.feedback}
            canRegenerate={canRegenerate}
            onRegenerate={onRegenerate}
            onFeedback={onFeedback}
          />
        )}
      </div>
    </div>
  )
}

// ── Welcome state ──────────────────────────────────────────────────────────────

function WelcomeState({ hasProfiles }: { hasProfiles: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/60">
        <Sparkles className="size-6 text-primary" />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-foreground">
          {hasProfiles ? "Start a conversation" : "Connect a model first"}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {hasProfiles
            ? "Type a message below to begin."
            : "Go to Models and add an API key to get started."}
        </p>
      </div>
      {!hasProfiles && (
        <Link
          href="/models"
          className="rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary/90"
        >
          Configure models
        </Link>
      )}
    </div>
  )
}

// ── Build context block from instance stats ────────────────────────────────────

function buildContextBlock(ctx: ChatInstanceContext): string {
  const libs = ctx.libraries
    .map((l) => `${l.name} (${l.count} file${l.count !== 1 ? "s" : ""})`)
    .join(", ")

  const byType = ctx.byMediaType
    .sort((a, b) => b.count - a.count)
    .map((r) => `${r.type.charAt(0) + r.type.slice(1).toLowerCase()}: ${r.count}`)
    .join(", ")

  const total = ctx.byMediaType.reduce((s, r) => s + r.count, 0)
  const storageStr = ctx.storageGb < 1
    ? `${Math.round(ctx.storageGb * 1024)} MB`
    : `${ctx.storageGb} GB`

  const lastUpload = ctx.lastUploadAt
    ? `Last upload: ${relTime(ctx.lastUploadAt)}`
    : "No uploads yet"

  return [
    "--- Current Instance Data ---",
    `Libraries: ${libs || "none"}`,
    `Total assets: ${total} (${byType || "none"})`,
    `Storage used: ${storageStr}`,
    lastUpload,
    "---",
  ].join("\n")
}

/** User explicitly asked to see/browse files this turn (not just counts or greetings). */
function userWantsAssetGallery(userText: string): boolean {
  const t = userText.trim()
  if (!t) return false

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
    /\b(list|show|see|view|open)\s+(?:all\s+)?(?:my\s+)?(?:the\s+)?(?:recent\s+)?/i.test(t)
  const mentionsMedia =
    /\b(images?|pictures?|photos?|videos?|files?|music|documents?|library|libraries|media|assets?|uploads?)\b/i.test(
      t,
    )

  if (wantsSee && mentionsMedia) return true

  if (/\b(show|see|display)\b/i.test(t) && /\b(recent|latest|newest)\b/i.test(t) && mentionsMedia) {
    return true
  }

  return false
}

/** Remove [[ASSETS:...]] blocks when the user did not ask to see files. */
function stripUnrequestedAssetTags(content: string, userText: string): string {
  if (userWantsAssetGallery(userText) || !/\[\[ASSETS:/i.test(content)) return content
  return content
    .replace(/\n*\[\[ASSETS:[^\]]+\]\]\n*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
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
function shouldAttachVisionToUserMessage(userText: string, priorMessages: Message[]): boolean {
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

// ── Relative time ──────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)   return "just now"
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

// ── Inline asset cards ─────────────────────────────────────────────────────────

const MEDIA_TYPE_MAP: Record<string, string> = {
  images: "IMAGE",
  videos: "VIDEO",
  music:  "AUDIO",
  documents: "DOCUMENT",
}

function InlineAssetBlockByIds({ assetIds }: { assetIds: string[] }) {
  const query = useQuery({
    queryKey: queryKeys.assets({ _chatIds: assetIds.join(",") }),
    queryFn: ({ signal }) => getAssetsByIds(assetIds, signal),
    enabled: assetIds.length > 0,
    staleTime: 30_000,
  })

  if (query.isLoading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading matches…
      </div>
    )
  }

  const assets = query.data ?? []
  if (!assets.length) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        Matched images are no longer available.
      </div>
    )
  }

  return (
    <div className={cn("my-2 grid gap-1.5", assets.length === 1 ? "grid-cols-1 max-w-[200px]" : "grid-cols-2 sm:grid-cols-3")}>
      {assets.map((asset) => {
        const hasThumbnail = asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO"
        const thumbUrl = `${ASSET_API_BASE}/assets/${asset.id}/thumbnail`
        return (
          <div
            key={asset.id}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
          >
            <div className="relative aspect-video overflow-hidden bg-muted/50">
              {hasThumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                  <File className="size-5" />
                </div>
              )}
            </div>
            <div className="px-2.5 py-2">
              <p className="truncate text-[11px] font-medium text-foreground">{asset.originalFilename}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase text-muted-foreground">
                  {asset.extension}
                </span>
                <span className="text-[10px] text-muted-foreground">{fmtBytes(asset.sizeBytes)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InlineAssetBlock({ mediaType, limit = 9 }: { mediaType: string; limit?: number }) {
  const filter = MEDIA_TYPE_MAP[mediaType] ? { mediaType: MEDIA_TYPE_MAP[mediaType] } : {}
  const query = useQuery({
    queryKey: queryKeys.assets({ ...filter, _chatBlock: mediaType }),
    queryFn: ({ signal }) => getAssets(filter, signal),
    staleTime: 30_000,
  })

  if (query.isLoading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading {mediaType}…
      </div>
    )
  }

  const assets = query.data ?? []

  if (!assets.length) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        No {mediaType} found.
      </div>
    )
  }

  const shown = assets.slice(0, limit)

  return (
    <div className={cn("my-2 grid gap-1.5", limit === 1 ? "grid-cols-1 max-w-[200px]" : "grid-cols-2 sm:grid-cols-3")}>
      {shown.map((asset) => {
        const hasThumbnail = asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO"
        const thumbUrl = `${ASSET_API_BASE}/assets/${asset.id}/thumbnail`
        return (
          <div
            key={asset.id}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
          >
            <div className="relative aspect-video overflow-hidden bg-muted/50">
              {hasThumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                    const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
                    if (fallback) fallback.hidden = false
                  }}
                />
              ) : null}
              <div
                hidden={hasThumbnail}
                className="flex h-full w-full items-center justify-center text-muted-foreground/40"
              >
                <File className="size-5" />
              </div>
            </div>
            <div className="px-2.5 py-2">
              <p className="truncate text-[11px] font-medium text-foreground">
                {asset.originalFilename}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase text-muted-foreground">
                  {asset.extension}
                </span>
                <span className="text-[10px] text-muted-foreground">{fmtBytes(asset.sizeBytes)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── History sidebar ────────────────────────────────────────────────────────────

function HistorySidebar({
  conversations,
  activeId,
  loadingId,
  loading,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: ChatConversationSummary[]
  activeId: string | null
  loadingId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <span className="text-[12px] font-semibold text-foreground">History</span>
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/60"
        >
          <Plus className="size-3.5" />
          New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Clock className="size-5 text-muted-foreground/50" />
            <p className="text-[12px] text-muted-foreground">No past conversations</p>
          </div>
        ) : (
          conversations.map((convo) => {
            const active = convo.id === activeId
            const preview = convo.messages[0]?.content.slice(0, 80) ?? ""
            return (
              <div
                key={convo.id}
                className={cn(
                  "group relative mb-0.5 cursor-pointer rounded-xl px-2.5 py-2 transition-colors",
                  active ? "bg-primary/[0.08] ring-1 ring-primary/20" : "hover:bg-muted/60",
                )}
                onClick={() => onSelect(convo.id)}
              >
                <div className="flex items-start gap-2">
                  {loadingId === convo.id
                    ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                    : <MessageSquare className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  }
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[12px] font-medium", active ? "text-primary" : "text-foreground")}>
                      {convo.title}
                    </p>
                    {preview && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{preview}</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground/60">{relTime(convo.updatedAt)}</p>
                  </div>
                </div>

                {/* Delete button — appears on hover */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(convo.id) }}
                  className="absolute right-2 top-2 hidden rounded-lg p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                  title="Delete conversation"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Main chat page ─────────────────────────────────────────────────────────────

export function ChatPage() {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<ChatProfile | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const aiSettingsQuery = useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: ({ signal }) => getAiSettings(signal),
    staleTime: 30_000,
  })
  const showThinking = aiSettingsQuery.data?.showThinking ?? false

  const systemInstruction = typeof window !== "undefined"
    ? (localStorage.getItem(SYSTEM_INSTRUCTION_KEY) ?? ARCIIN_DEFAULT_SYSTEM_INSTRUCTION)
    : ARCIIN_DEFAULT_SYSTEM_INSTRUCTION

  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const abortRef       = useRef<AbortController | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const profilesQuery = useQuery({
    queryKey: queryKeys.chatProfiles,
    queryFn: ({ signal }) =>
      fetchApi<ChatProfile[]>("/chat/profiles", { signal }) as Promise<ChatProfile[]>,
  })

  const historyQuery = useQuery({
    queryKey: queryKeys.chatConversations,
    queryFn: ({ signal }) => getChatConversations(signal),
  })

  const contextQuery = useQuery({
    queryKey: queryKeys.chatContext,
    queryFn: ({ signal }) => getChatInstanceContext(signal),
    staleTime: 30_000,
  })

  const profiles      = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data])
  const conversations = useMemo(() => historyQuery.data ?? [], [historyQuery.data])

  const activeModelLabel = selectedModel || selectedProfile?.defaultModel || ""
  const ollamaChat = Boolean(selectedProfile && isOllamaProvider(selectedProfile.provider))
  const ollamaShowQuery = useQuery({
    queryKey: queryKeys.ollamaModelShow(selectedProfile?.id ?? "", activeModelLabel),
    queryFn: ({ signal }) => getOllamaModelShow(selectedProfile!.id, { model: activeModelLabel }, signal),
    enabled: Boolean(selectedProfile?.id && activeModelLabel && ollamaChat),
    staleTime: 300_000,
  })
  /** Settings may hide the toggle for non–thinking-capable Ollama models; chat still streams traces when the model emits them. */
  const reasoningUiEnabled = showThinking

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: deleteChatConversation,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })
      if (conversationId === id) startNewChat()
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete conversation."),
  })

  // ── Restore model picker from last session (then fall back to default profile) ─

  useEffect(() => {
    if (profiles.length === 0 || selectedProfile) return

    let savedProfileId: string | null = null
    let savedModel = ""
    try {
      savedProfileId = localStorage.getItem(CHAT_SELECTED_PROFILE_ID_KEY)
      savedModel = localStorage.getItem(CHAT_SELECTED_MODEL_KEY) ?? ""
    } catch {
      /* private mode */
    }

    const bySavedId = savedProfileId ? profiles.find((p) => p.id === savedProfileId) : null
    const profile = bySavedId ?? profiles.find((p) => p.isDefault) ?? profiles[0]
    setSelectedProfile(profile)

    if (bySavedId && savedModel) {
      setSelectedModel(savedModel)
    } else {
      setSelectedModel(profile.defaultModel ?? "")
    }
  }, [profiles, selectedProfile])

  // ── Scroll ─────────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = messagesScrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" })
  }, [])

  useLayoutEffect(() => {
    scrollToBottom(streaming)
  }, [messages, streaming, scrollToBottom])

  function handleMessagesScroll() {
    const el = messagesScrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = dist < 100
  }

  // ── Load conversation ──────────────────────────────────────────────────────

  const [loadingConvoId, setLoadingConvoId] = useState<string | null>(null)

  async function loadConversation(id: string) {
    if (id === conversationId) {
      setHistoryOpen(false)
      return
    }
    setLoadingConvoId(id)
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.chatConversation(id),
        queryFn:  ({ signal }) => getChatConversation(id, signal),
        staleTime: 30_000,
      })
      setConversationId(id)
      setMessages(
        detail.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            id: m.id,
            dbId: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            feedback: m.feedbackRating ?? null,
            usage: m.totalTokens
              ? { inputTokens: m.inputTokens ?? 0, outputTokens: m.outputTokens ?? 0, totalTokens: m.totalTokens }
              : undefined,
          })),
      )
      setHistoryOpen(false)
    } catch {
      toast.error("Could not load conversation.")
    } finally {
      setLoadingConvoId(null)
    }
  }

  function startNewChat() {
    setConversationId(null)
    setMessages([])
    setInput("")
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }


  async function handleMessageFeedback(msg: Message, rating: ChatMessageFeedbackRating | null) {
    const persistId = messagePersistId(msg)
    if (msg.pending) return
    if (!persistId) {
      toast.message("Saving this reply… try again in a moment.")
      return
    }
    const next = msg.feedback === rating ? null : rating
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, feedback: next, dbId: persistId } : m)),
    )
    try {
      const updated = await setChatMessageFeedback(persistId, next)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id
            ? { ...m, feedback: updated.feedbackRating ?? null, dbId: updated.id }
            : m,
        ),
      )
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, feedback: msg.feedback ?? null } : m)),
      )
      toast.error("Could not save feedback")
    }
  }

  function applyPersistedMessageIds(
    prev: Message[],
    saved: { id: string; role: string }[],
    pendingAssistantId: string,
    pendingUserId?: string,
  ) {
    const userRow = saved.find((m) => m.role === "user")
    const asstRow = saved.find((m) => m.role === "assistant")
    return prev.map((m) => {
      if (pendingUserId && m.id === pendingUserId && userRow) {
        return { ...m, id: userRow.id, dbId: userRow.id }
      }
      if (m.id === pendingAssistantId && asstRow) {
        return { ...m, id: asstRow.id, dbId: asstRow.id }
      }
      return m
    })
  }

  async function regenerateAssistantMessage(assistantMsgId: string) {
    if (streaming) return
    const aiIdx = messages.findIndex((m) => m.id === assistantMsgId)
    if (aiIdx <= 0) return
    const userMsg = messages[aiIdx - 1]
    if (!userMsg || userMsg.role !== "user") return

    const replaceDbId = messages[aiIdx]?.dbId
    const priorMessages = messages.slice(0, aiIdx)
    const userText = userMsg.content
    const pendingMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
    }

    stickToBottomRef.current = true
    setMessages([...priorMessages, pendingMsg])
    setStreaming(true)
    setStreamingMsgId(pendingMsg.id)

    const profile = selectedProfile ?? profiles[0]
    if (!profile) {
      toast.error("No model selected.")
      setStreaming(false)
      setStreamingMsgId(null)
      return
    }

    type OutboundMsg = { role: "user" | "assistant" | "system"; content: string; images?: string[] }
    const history: OutboundMsg[] = priorMessages.map((m) => ({ role: m.role, content: m.content }))
    const sysPrompt = systemInstruction.trim()
    const instanceBlock = contextQuery.data ? "\n\n" + buildContextBlock(contextQuery.data) : ""
    const caps = ollamaShowQuery.data?.capabilities
    const visionCapable =
      ollamaChat &&
      (ollamaCapabilitiesIncludeVision(caps) !== false ||
        /qwen3\.5|llava|gemma.*vision|minicpm-v|moondream|bakllava/i.test(activeModelLabel))
    const modelToSend = selectedModel || profile.defaultModel || undefined

    let visionImages: string[] | undefined
    if (visionCapable && shouldAttachVisionToUserMessage(userText, priorMessages.slice(0, -1))) {
      try {
        const limit: 1 | 2 | 3 = /\b(compare|both|all three|each of)\b/i.test(userText) ? 2 : 1
        const vision = await getChatVisionRecent(limit)
        if (vision.images.length > 0) visionImages = vision.images
      } catch { /* optional */ }
    }

    let sysTail = instanceBlock
    if (visionImages?.length) {
      sysTail +=
        visionImages.length === 1
          ? "\n\n[Vision — REQUIRED] Image pixels are attached to the user's latest message."
          : `\n\n[Vision — REQUIRED] ${visionImages.length} library images are attached.`
    }

    const fullSysPrompt = sysPrompt + sysTail
    const payload: OutboundMsg[] = fullSysPrompt
      ? [{ role: "system", content: fullSysPrompt }, ...history]
      : history

    if (visionImages?.length) {
      for (let i = payload.length - 1; i >= 0; i--) {
        if (payload[i].role === "user") {
          payload[i] = {
            ...payload[i],
            images: visionImages,
            content: `${payload[i].content}\n\n(Attached library image pixels for this turn.)`,
          }
          break
        }
      }
    }

    abortRef.current = new AbortController()
    let finalContent = ""
    let finalUsage: TokenUsage | undefined

    try {
      const res = await fetch(getChatStreamPostUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profileId: profile.id, model: modelToSend, messages: payload }),
        signal: abortRef.current.signal,
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: { message: "Request failed" } }))
        throw new Error(err?.error?.message ?? "Chat request failed")
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let accumulated = ""
      let thinkingAccum = ""
      let streamDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        if (done) buffer += decoder.decode()
        const lines = buffer.split("\n")
        buffer = done ? "" : (lines.pop() ?? "")
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const sseLine = trimmed.slice(5).trim()
          if (sseLine === "[DONE]") { streamDone = true; continue }
          try {
            const json = JSON.parse(sseLine) as {
              error?: string; text?: string; thinking?: string; usage?: TokenUsage; libraryAction?: string
            }
            if (json.error) throw new Error(json.error)
            if (json.libraryAction) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.assets() })
              void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
            }
            if (json.thinking) thinkingAccum += json.thinking
            if (json.text) accumulated += json.text
            if (json.usage) finalUsage = json.usage
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") throw parseErr
          }
        }
        const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showThinking)
        const displayThinking =
          reasoningUiEnabled && (derived.thinking.length > 0 || derived.inReasoningBlock) ? derived.thinking : undefined
        const displayContent = finalizeAssistantContent(derived.answer, userText)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, content: displayContent, thinking: displayThinking, pending: false, usage: finalUsage ?? m.usage }
              : m,
          ),
        )
        if (streamDone || done) break
      }

      const resolved = resolveFinalAssistantMessage(accumulated, thinkingAccum, showThinking, reasoningUiEnabled)
      finalContent = finalizeAssistantContent(resolved.content, userText)
      const finalThinking = resolved.thinking
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? { ...m, content: finalContent, thinking: finalThinking, pending: false, usage: finalUsage ?? m.usage }
            : m,
        ),
      )

      if (finalContent && conversationId) {
        try {
          if (replaceDbId) {
            await updateChatMessage(replaceDbId, {
              content: finalContent,
              inputTokens: finalUsage?.inputTokens,
              outputTokens: finalUsage?.outputTokens,
              totalTokens: finalUsage?.totalTokens,
            })
            setMessages((prev) =>
              prev.map((m) =>
                m.id === pendingMsg.id
                  ? { ...m, id: replaceDbId, dbId: replaceDbId, feedback: m.feedback ?? null }
                  : m,
              ),
            )
          } else {
            const saved = await saveChatMessages({
              conversationId,
              messages: [{
                role: "assistant",
                content: finalContent,
                inputTokens: finalUsage?.inputTokens,
                outputTokens: finalUsage?.outputTokens,
                totalTokens: finalUsage?.totalTokens,
              }],
            })
            setMessages((prev) => applyPersistedMessageIds(prev, saved.messages, pendingMsg.id))
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })
        } catch { /* silent */ }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id))
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, content: err instanceof Error ? err.message : "Something went wrong.", pending: false }
              : m,
          ),
        )
      }
    } finally {
      setStreaming(false)
      setStreamingMsgId(null)
      abortRef.current = null
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return

    const profile = selectedProfile ?? profiles[0]
    if (!profile) {
      toast.error("No model selected. Connect one under Models.")
      return
    }

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text }
    const pendingMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
    }

    stickToBottomRef.current = true
    setMessages((prev) => [...prev, userMsg, pendingMsg])
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    setStreaming(true)

    type OutboundMsg = {
      role: "user" | "assistant" | "system"
      content: string
      images?: string[]
    }

    const history: OutboundMsg[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const sysPrompt = systemInstruction.trim()

    const instanceBlock = contextQuery.data ? "\n\n" + buildContextBlock(contextQuery.data) : ""
    const caps = ollamaShowQuery.data?.capabilities
    const visionCapable =
      ollamaChat &&
      (ollamaCapabilitiesIncludeVision(caps) !== false ||
        /qwen3\.5|llava|gemma.*vision|minicpm-v|moondream|bakllava/i.test(activeModelLabel))

    const modelToSend = selectedModel || profile.defaultModel || undefined

    let visionImages: string[] | undefined
    if (visionCapable && shouldAttachVisionToUserMessage(text, messages)) {
      try {
        const limit: 1 | 2 | 3 = /\b(compare|both|all three|each of)\b/i.test(text) ? 2 : 1
        const vision = await getChatVisionRecent(limit)
        if (vision.images.length > 0) {
          visionImages = vision.images
        } else {
          toast.warning("No readable image file found in your library for vision (file missing or over 4 MB).")
        }
      } catch {
        toast.error("Could not load your image for the model. Check that the file exists in Images.")
      }
    }

    let sysTail = instanceBlock
    if (visionImages?.length) {
      sysTail +=
        visionImages.length === 1
          ? "\n\n[Vision — REQUIRED] Image pixels are attached to the user's latest message (Ollama `images` field). You CAN see this image. Describe subjects, colors, text, and scene in detail. Never say you cannot view images or only have metadata for this turn."
          : `\n\n[Vision — REQUIRED] ${visionImages.length} library images are attached to the user's latest message. You CAN see them. Describe what you see. Never say you cannot view images for this turn.`
    }

    const fullSysPrompt = sysPrompt + sysTail
    const payload: OutboundMsg[] = fullSysPrompt
      ? [{ role: "system", content: fullSysPrompt }, ...history]
      : history

    if (visionImages?.length) {
      for (let i = payload.length - 1; i >= 0; i--) {
        if (payload[i].role === "user") {
          payload[i] = {
            ...payload[i],
            images: visionImages,
            content: `${payload[i].content}\n\n(Attached: ${visionImages.length === 1 ? "the library image" : `${visionImages.length} library images`} as pixels for this turn — describe what you see.)`,
          }
          break
        }
      }
    }

    setStreamingMsgId(pendingMsg.id)
    abortRef.current = new AbortController()

    let finalContent = ""
    let finalUsage:  TokenUsage | undefined

    try {
      const res = await fetch(getChatStreamPostUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profileId: profile.id, model: modelToSend, messages: payload }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: { message: "Request failed" } }))
        throw new Error(err?.error?.message ?? "Chat request failed")
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let accumulated  = ""  // text/content chunks (may contain <think> tags in some models)
      let thinkingAccum = "" // dedicated thinking chunks (Ollama native / compat)
      let streamDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        if (done) buffer += decoder.decode()

        const lines = buffer.split("\n")
        buffer = done ? "" : (lines.pop() ?? "")

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const sseLine = trimmed.slice(5).trim()
          if (sseLine === "[DONE]") {
            streamDone = true
            continue
          }

          try {
            const json = JSON.parse(sseLine) as {
              error?: string
              text?: string
              thinking?: string
              usage?: TokenUsage
              libraryAction?: string
            }
            if (json.error) throw new Error(json.error)

            if (json.libraryAction) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.assets() })
              void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
            }

            if (json.thinking) thinkingAccum += json.thinking
            if (json.text) accumulated += json.text
            if (json.usage) finalUsage = json.usage
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
              throw parseErr
            }
          }
        }

        const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showThinking)
        const displayThinking =
          reasoningUiEnabled && (derived.thinking.length > 0 || derived.inReasoningBlock)
            ? derived.thinking
            : undefined
        const displayContent = finalizeAssistantContent(derived.answer, text)

        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? {
                  ...m,
                  content: displayContent,
                  thinking: displayThinking,
                  
                  pending: false,
                  usage: finalUsage ?? m.usage,
                }
              : m,
          ),
        )

        if (streamDone || done) break
      }

      const resolved = resolveFinalAssistantMessage(
        accumulated,
        thinkingAccum,
        showThinking,
        reasoningUiEnabled,
      )
      finalContent = finalizeAssistantContent(resolved.content, text)
      const finalThinking = resolved.thinking
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                content: finalContent,
                thinking: finalThinking,
                
                pending: false,
                usage: finalUsage ?? m.usage,
              }
            : m,
        ),
      )

      // ── Persist to database ──────────────────────────────────────────────
      if (finalContent) {
        try {
          let convoId = conversationId
          if (!convoId) {
            // Create a new conversation titled from the first user message
            const title = text.slice(0, 80).replace(/\n/g, " ")
            const newConvo = await createChatConversation({ title, profileId: profile.id })
            convoId = newConvo.id
            setConversationId(convoId)
            queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })
          }

          const saved = await saveChatMessages({
            conversationId: convoId,
            messages: [
              { role: "user", content: text },
              {
                role: "assistant",
                content: finalContent,
                inputTokens: finalUsage?.inputTokens,
                outputTokens: finalUsage?.outputTokens,
                totalTokens: finalUsage?.totalTokens,
              },
            ],
          })
          setMessages((prev) =>
            applyPersistedMessageIds(prev, saved.messages, pendingMsg.id, userMsg.id),
          )
          queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })
        } catch {
          toast.error("Could not save this conversation to history.")
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id))
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, content: err instanceof Error ? err.message : "Something went wrong.", pending: false }
              : m,
          ),
        )
      }
    } finally {
      setStreaming(false)
      setStreamingMsgId(null)
      abortRef.current = null
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const canSend = input.trim().length > 0 && !streaming && profiles.length > 0

  return (
    <div className="-mx-3 -my-4 flex min-h-0 flex-1 overflow-hidden sm:-mx-4 lg:-mx-5">
      {/* ── History sidebar ──────────────────────────────────────────────── */}
      <div
        className={cn(
          "hidden border-r border-border bg-card/60 transition-all duration-200 sm:flex sm:flex-col",
          historyOpen ? "sm:w-60 lg:w-64" : "sm:w-0 sm:overflow-hidden sm:border-r-0",
        )}
      >
        {historyOpen && (
          <HistorySidebar
            conversations={conversations}
            activeId={conversationId}
            loadingId={loadingConvoId}
            loading={historyQuery.isLoading}
            onSelect={loadConversation}
            onNew={startNewChat}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        )}
      </div>

      {/* ── Chat area ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Messages — scrollable; clicking here dismisses the history sidebar */}
        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="scrollbar-hide relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          onClick={() => { if (historyOpen) setHistoryOpen(false) }}
        >
          {/* Floating top bar — overlays messages, never pushes layout */}
          <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-between px-4 pt-3 sm:px-6">
            <div className="pointer-events-auto">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setHistoryOpen((v) => !v) }}
                className="hidden items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground sm:flex"
                title={historyOpen ? "Hide history" : "Show history"}
              >
                <Clock className="size-3" />
                {historyOpen ? "Hide history" : "History"}
              </button>
            </div>

            {messages.length > 0 && (
              <div className="pointer-events-auto flex items-center gap-2">
                {streaming && (
                  <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-medium text-primary backdrop-blur-md">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    Generating…
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); abortRef.current?.abort(); startNewChat() }}
                  className="flex items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                  Clear
                </button>
              </div>
            )}
          </div>

          {messages.length === 0 ? (
            <WelcomeState hasProfiles={profiles.length > 0} />
          ) : (
            <div className="flex flex-col gap-4 px-4 py-6 pb-8 sm:px-8 lg:px-16 xl:px-24">
              {(() => {
                const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id
                return messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isLive={msg.id === streamingMsgId}
                  reasoningUiEnabled={reasoningUiEnabled}
                  isStreaming={streaming && msg.id === streamingMsgId}
                  canRegenerate={msg.role === "assistant" && msg.id === lastAssistantId && !streaming && !msg.pending}
                  onRegenerate={
                    msg.role === "assistant" && msg.id === lastAssistantId
                      ? () => void regenerateAssistantMessage(msg.id)
                      : undefined
                  }
                  onFeedback={
                    msg.role === "assistant"
                      ? (rating) => void handleMessageFeedback(msg, rating)
                      : undefined
                  }
                />
              ))
              })()}

            </div>
          )}
        </div>

        {/* Input pill */}
        <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex min-h-[54px] items-center gap-0 rounded-2xl border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-primary/20">
              <ModelPicker
                profiles={profiles}
                selectedProfile={selectedProfile}
                selectedModel={selectedModel}
                onChange={(profile, model) => {
                  setSelectedProfile(profile)
                  setSelectedModel(model)
                  try {
                    localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, profile.id)
                    localStorage.setItem(CHAT_SELECTED_MODEL_KEY, model)
                  } catch {
                    /* private mode */
                  }
                }}
                ollamaShow={ollamaShowQuery.data}
                ollamaShowLoading={ollamaShowQuery.isFetching}
              />
              <div className="h-5 w-px shrink-0 bg-border" />
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message…"
                disabled={streaming || profiles.length === 0}
                className="min-h-[54px] flex-1 resize-none bg-transparent px-3 py-4 text-[14px] leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="flex shrink-0 items-center px-2">
                <Button
                  size="icon"
                  disabled={!canSend}
                  onClick={sendMessage}
                  className="size-8 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
                >
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
