import {
  type AiChatToolBehavior,
  type AiSecuritySettingsResolved,
  normalizeVisionSearchQuery,
} from "@arciin/shared"

import {
  ARCIIN_CHAT_TOOLS,
  type ArciinChatToolContext,
  executeArciinChatTool,
} from "@/services/chat/arciin-chat-tools"

export function detectLibraryToolIntent(
  userText: string,
): "vision_search_library" | "organize_images_library" | null {
  const t = userText.toLowerCase()
  const wantsOrganize =
    /\b(organiz|sort|arrang|categor|group|folder)\w*/.test(t) &&
    /\b(folder|library|image|photo|file)\b/.test(t)
  if (wantsOrganize) return "organize_images_library"

  const wantsSearch =
    (/\b(find|search|look for|locate|show me|get me)\b/.test(t) ||
      /\b(is there|do i have|any)\b/.test(t)) &&
    /\b(image|picture|photo|library)\b/.test(t)
  if (wantsSearch) return "vision_search_library"

  return null
}

function toolArgsForIntent(
  intent: "vision_search_library" | "organize_images_library",
  userText: string,
): Record<string, unknown> {
  if (intent === "vision_search_library") {
    return { query: normalizeVisionSearchQuery(userText), maxResults: 3 }
  }
  return { maxAssets: 20 }
}

type ChatMsg = {
  role: string
  content: string
  images?: string[]
  tool_calls?: unknown[]
}

type OllamaMessage = {
  message?: {
    role?: string
    content?: string
    thinking?: string
    thought?: string
    tool_calls?: Array<{
      function?: { name?: string; arguments?: Record<string, unknown> | string }
    }>
  }
  done?: boolean
  prompt_eval_count?: number
  eval_count?: number
}

const MAX_TOOL_ROUNDS = 4

function thinkOption(model: string): boolean | string {
  return /gpt-oss/i.test(model) ? "medium" : true
}

/** Stream thinking/text deltas to the client (SSE). */
function writeSseDelta(
  raw: import("http").ServerResponse,
  kind: "thinking" | "text",
  full: string,
  prevFull: string,
): string {
  if (!full || full === prevFull) return prevFull
  const delta = full.startsWith(prevFull) ? full.slice(prevFull.length) : full
  if (delta) {
    raw.write(`data: ${JSON.stringify({ [kind]: delta })}\n\n`)
  }
  return full
}

type ToolMode = false | "all" | "read-only"

function resolveOllamaTools(mode: ToolMode) {
  if (mode === false) return undefined
  if (mode === "read-only") {
    return ARCIIN_CHAT_TOOLS.filter((t) => t.function.name === "vision_search_library")
  }
  return ARCIIN_CHAT_TOOLS
}

async function ollamaChatOnce(
  baseUrl: string,
  model: string,
  messages: ChatMsg[],
  opts: { stream: boolean; tools?: ToolMode },
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: opts.stream,
    think: thinkOption(model),
  }
  const tools = opts.tools === undefined ? undefined : resolveOllamaTools(opts.tools)
  if (tools?.length) body.tools = tools

  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  })
}

async function collectStreamedOllama(
  res: Response,
  raw: import("http").ServerResponse,
  forward: { thinking: boolean; text: boolean },
): Promise<OllamaMessage["message"] & { usage?: { inputTokens: number; outputTokens: number } }> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let prevThinking = ""
  let prevContent = ""
  let finalMessage: OllamaMessage["message"] = {}
  let usage = { inputTokens: 0, outputTokens: 0 }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    if (done) buffer += decoder.decode()

    const lines = buffer.split("\n")
    buffer = done ? "" : (lines.pop() ?? "")

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const json = JSON.parse(trimmed) as OllamaMessage
        const m = json.message ?? {}
        finalMessage = m

        const thinkingFull =
          (typeof m.thinking === "string" ? m.thinking : "") ||
          (typeof m.thought === "string" ? m.thought : "")
        const contentFull = typeof m.content === "string" ? m.content : ""

        if (forward.thinking) {
          prevThinking = writeSseDelta(raw, "thinking", thinkingFull, prevThinking)
        }
        if (forward.text) {
          prevContent = writeSseDelta(raw, "text", contentFull, prevContent)
        }

        if (json.done) {
          usage = {
            inputTokens: json.prompt_eval_count ?? 0,
            outputTokens: json.eval_count ?? 0,
          }
        }
      } catch {
        /* skip */
      }
    }
    if (done) break
  }

  return { ...finalMessage, usage }
}

/**
 * Ollama chat with Arciin tools — one user turn, multiple internal tool rounds,
 * single streamed assistant reply (after tools complete).
 */
async function streamFinalAnswer(
  raw: import("http").ServerResponse,
  baseUrl: string,
  model: string,
  messages: ChatMsg[],
  totalIn: number,
  totalOut: number,
): Promise<void> {
  const answerRes = await ollamaChatOnce(baseUrl, model, messages, {
    stream: true,
    tools: false,
  })
  if (!answerRes.ok || !answerRes.body) {
    const text = await answerRes.text().catch(() => answerRes.statusText)
    throw new Error(`Provider error ${answerRes.status}: ${text.slice(0, 200)}`)
  }
  const final = await collectStreamedOllama(answerRes, raw, { thinking: true, text: true })
  const inTok = totalIn + (final.usage?.inputTokens ?? 0)
  const outTok = totalOut + (final.usage?.outputTokens ?? 0)
  raw.write(
    `data: ${JSON.stringify({
      usage: {
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: inTok + outTok,
      },
    })}\n\n`,
  )
}

export async function streamOllamaWithArciinTools(opts: {
  raw: import("http").ServerResponse
  baseUrl: string
  model: string
  messages: ChatMsg[]
  toolCtx: ArciinChatToolContext
  ai?: AiChatToolBehavior
  security?: Pick<AiSecuritySettingsResolved, "readOnlyTools" | "requireToolApproval">
}): Promise<void> {
  const { raw, baseUrl, model, toolCtx } = opts
  const agentEnabled = opts.ai?.agent ?? true
  const autonomyEnabled = opts.ai?.autonomy ?? false
  const requireApproval = opts.security?.requireToolApproval ?? false
  const readOnlyTools = opts.security?.readOnlyTools ?? false
  const toolMode: ToolMode = !agentEnabled ? false : readOnlyTools ? "read-only" : "all"

  let messages = [...opts.messages]
  let totalIn = 0
  let totalOut = 0

  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  let libraryIntent = lastUser ? detectLibraryToolIntent(lastUser.content) : null
  if (libraryIntent === "organize_images_library" && readOnlyTools) {
    libraryIntent = null
  }

  if (libraryIntent && lastUser && agentEnabled && autonomyEnabled && !requireApproval) {
    raw.write(`data: ${JSON.stringify({ libraryAction: libraryIntent })}\n\n`)

    const args = toolArgsForIntent(libraryIntent, lastUser.content)
    const syntheticCall = {
      function: { name: libraryIntent, arguments: args },
    }
    const result = await executeArciinChatTool(syntheticCall, toolCtx)

    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [syntheticCall],
    })
    messages.push({
      role: "tool",
      content: JSON.stringify(result),
    })

    await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut)
    return
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await ollamaChatOnce(baseUrl, model, messages, {
      stream: true,
      tools: toolMode,
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Provider error ${res.status}: ${text.slice(0, 200)}`)
    }

    const collected = await collectStreamedOllama(res, raw, {
      thinking: true,
      text: true,
    })
    totalIn += collected.usage?.inputTokens ?? 0
    totalOut += collected.usage?.outputTokens ?? 0

    const toolCalls = collected.tool_calls
    if (!toolCalls?.length) {
      const answer = (collected.content ?? "").trim()
      const thinking =
        (typeof collected.thinking === "string" ? collected.thinking : "").trim() ||
        (typeof collected.thought === "string" ? collected.thought : "").trim()
      // Some thinking models leave `content` empty and put the user-visible reply in `thinking`.
      if (!answer && thinking) {
        raw.write(`data: ${JSON.stringify({ text: thinking })}\n\n`)
      }
      raw.write(
        `data: ${JSON.stringify({
          usage: {
            inputTokens: totalIn,
            outputTokens: totalOut,
            totalTokens: totalIn + totalOut,
          },
        })}\n\n`,
      )
      return
    }

    messages.push({
      role: "assistant",
      content: collected.content ?? "",
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      if (!agentEnabled) break
      const toolName = call.function?.name
      if (toolName) {
        raw.write(`data: ${JSON.stringify({ libraryAction: toolName })}\n\n`)
      }
      const result = await executeArciinChatTool(call, toolCtx)
      messages.push({
        role: "tool",
        content: JSON.stringify(result),
      })
    }
  }

  await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut)
}
