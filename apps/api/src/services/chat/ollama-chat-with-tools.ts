import {
  libraryAllowsFolderMutations,
  type AiChatToolBehavior,
  type AiLibraryToolAccess,
  type AiSecuritySettingsResolved,
  normalizeVisionSearchQuery,
} from "@arciin/shared"

import {
  ARCIIN_CHAT_TOOLS,
  type ArciinChatToolContext,
  executeArciinChatTool,
} from "@/services/chat/arciin-chat-tools"
import {
  assistantClaimsFolderMutation,
  buildSyntheticCreateLibraryFolderArgsFromUser,
  buildSyntheticDeleteLibraryFolderArgsFromUser,
  extractBracketPseudoToolCalls,
  extractProseLibraryFolderMutations,
} from "@/services/chat/folder-tool-synthetic"
import { buildSyntheticReadPdfAssetArgsFromUser } from "@/services/chat/read-pdf-asset-synthetic"
import { buildSyntheticReadTextAssetArgsFromUser } from "@/services/chat/read-text-asset-synthetic"
import { normalizeOllamaCloudModelId } from "@/services/chat/ollama-cloud-models"
import { formatOllamaProviderError, ollamaAuthHeaders } from "@/services/chat/ollama-http"
import { ollamaModelSupportsThinking } from "@/services/models/ollama-model-capabilities"
import { stripAssistantStreamMarkup } from "@arciin/shared"
import { writeSseEvent } from "@/services/chat/sse-stream"

export function detectLibraryToolIntent(
  userText: string,
): "vision_search_library" | "organize_images_library" | null {
  const t = userText.toLowerCase()
  if (/\b(delete|remove|trash)\b/.test(t) && /\bfolders?\b/.test(t)) return null
  if (/\b(create|add|make|start)\b/.test(t) && /\bfolders?\b/.test(t)) return null
  if (/\bnew\s+folders?\b/.test(t)) return null

  const wantsOrganize =
    /\b(organiz|sort|arrang|categor|group)\w*/.test(t) && /\b(folder|library|image|photo|file)\b/.test(t)
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

/** Ollama final answer pass uses tools:false — collapse tool history into plain messages. */
function flattenToolMessagesForFinalAnswer(messages: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role === "assistant" && m.tool_calls?.length) {
      const calls = m.tool_calls as Array<{ function?: { name?: string } }>
      const names = calls
        .map((c) => c.function?.name)
        .filter((n): n is string => Boolean(n))
      const toolPayloads: string[] = []
      let j = i + 1
      while (j < messages.length && messages[j]?.role === "tool") {
        toolPayloads.push(messages[j]!.content)
        j++
      }
      const lead = (m.content ?? "").trim()
      out.push({
        role: "assistant",
        content:
          lead ||
          (names.length > 0 ? `[Used tools: ${names.join(", ")}]` : "(tool call)"),
      })
      if (toolPayloads.length > 0) {
        out.push({
          role: "user",
          content: `Tool results (use these to answer the user — report findings in your final answer; do not say you will search or read):\n\n${toolPayloads
            .map((p, idx) => `--- Result ${idx + 1} ---\n${p}`)
            .join("\n\n")}`,
        })
      }
      i = j - 1
      continue
    }
    if (m.role === "tool") continue
    const content = (m.content ?? "").trim()
    out.push({ ...m, content: content || " " })
  }

  return out
}

function thinkOption(
  model: string,
  isCloud: boolean,
  thinkingSupported: boolean,
): boolean | string {
  if (/gpt-oss/i.test(model)) return isCloud ? "low" : "medium"
  if (!thinkingSupported) return false
  if (isCloud) return false
  return true
}

function ollamaThinkingNotSupportedError(status: number, text: string): boolean {
  return status === 400 && /does not support thinking/i.test(text)
}

/** Stream thinking/text deltas to the client (SSE). */
function writeSseDelta(
  raw: import("http").ServerResponse,
  kind: "thinking" | "text",
  full: string,
  prevFull: string,
): string {
  if (!full || full === prevFull) return prevFull
  const cleaned = kind === "text" ? stripAssistantStreamMarkup(full) : full
  const cleanedPrev = kind === "text" ? stripAssistantStreamMarkup(prevFull) : prevFull
  const delta = cleaned.startsWith(cleanedPrev)
    ? cleaned.slice(cleanedPrev.length)
    : cleaned
  if (delta) {
    writeSseEvent(raw, { [kind]: delta })
  }
  return cleaned
}

type ToolMode = false | "all" | "read-only" | "sandbox"

function resolveOllamaTools(mode: ToolMode) {
  if (mode === false) return undefined
  if (mode === "read-only") {
    return ARCIIN_CHAT_TOOLS.filter((t) => t.function.name === "vision_search_library")
  }
  if (mode === "sandbox") {
    return ARCIIN_CHAT_TOOLS.filter((t) => t.function.name !== "organize_images_library")
  }
  return ARCIIN_CHAT_TOOLS
}

async function ollamaChatOnce(
  baseUrl: string,
  model: string,
  messages: ChatMsg[],
  opts: {
    stream: boolean
    tools?: ToolMode
    apiKey?: string | null
    thinkingSupported: boolean
  },
): Promise<Response> {
  const isCloud = baseUrl.includes("ollama.com")
  const apiModel = isCloud ? normalizeOllamaCloudModelId(model) : model
  const think = thinkOption(apiModel, isCloud, opts.thinkingSupported)
  const buildBody = (thinkValue: boolean | string) => {
    const body: Record<string, unknown> = {
      model: apiModel,
      messages,
      stream: opts.stream,
      think: thinkValue,
    }
    const tools = opts.tools === undefined ? undefined : resolveOllamaTools(opts.tools)
    if (tools?.length) body.tools = tools
    return body
  }

  const post = (thinkValue: boolean | string) =>
    fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: ollamaAuthHeaders(opts.apiKey),
      body: JSON.stringify(buildBody(thinkValue)),
      signal: AbortSignal.timeout(600_000),
    })

  let res = await post(think)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    if (ollamaThinkingNotSupportedError(res.status, text) && think !== false) {
      res = await post(false)
      if (res.ok) return res
      const retryText = await res.text().catch(() => res.statusText)
      throw new Error(
        formatOllamaProviderError(res.status, retryText, {
          hasApiKey: Boolean(opts.apiKey?.trim()),
          isCloud,
        }),
      )
    }
    throw new Error(
      formatOllamaProviderError(res.status, text, {
        hasApiKey: Boolean(opts.apiKey?.trim()),
        isCloud,
      }),
    )
  }
  return res
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
  // Ollama sends per-chunk deltas; accumulate so writeSseDelta's diff logic preserves spaces
  let accumulatedThinking = ""
  let accumulatedContent = ""
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

        const thinkingDelta =
          (typeof m.thinking === "string" ? m.thinking : "") ||
          (typeof m.thought === "string" ? m.thought : "")
        const contentDelta = typeof m.content === "string" ? m.content : ""

        accumulatedThinking += thinkingDelta
        accumulatedContent += contentDelta

        if (forward.thinking) {
          prevThinking = writeSseDelta(raw, "thinking", accumulatedThinking, prevThinking)
        }
        if (forward.text) {
          prevContent = writeSseDelta(raw, "text", accumulatedContent, prevContent)
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

  return { ...finalMessage, content: accumulatedContent || finalMessage.content, usage }
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
  apiKey: string | null | undefined,
  thinkingSupported: boolean,
): Promise<void> {
  const answerRes = await ollamaChatOnce(baseUrl, model, flattenToolMessagesForFinalAnswer(messages), {
    stream: true,
    tools: false,
    apiKey,
    thinkingSupported,
  })
  if (!answerRes.body) {
    throw new Error("Provider error: empty response body from Ollama.")
  }
  const final = await collectStreamedOllama(answerRes, raw, {
    thinking: thinkingSupported,
    text: true,
  })
  const inTok = totalIn + (final.usage?.inputTokens ?? 0)
  const outTok = totalOut + (final.usage?.outputTokens ?? 0)
  writeSseEvent(raw, {
    usage: {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: inTok + outTok,
    },
  })
}

export async function streamOllamaWithArciinTools(opts: {
  raw: import("http").ServerResponse
  baseUrl: string
  model: string
  messages: ChatMsg[]
  apiKey?: string | null
  toolCtx: ArciinChatToolContext
  ai?: AiChatToolBehavior
  security?: Pick<AiSecuritySettingsResolved, "libraryToolAccess" | "readOnlyTools" | "requireToolApproval">
  /** Focused file preview already has PDF/text in context — skip tool rounds. */
  disableTools?: boolean
}): Promise<void> {
  const { raw, baseUrl, model, toolCtx, apiKey } = opts
  const agentEnabled = (opts.ai?.agent ?? true) && !opts.disableTools
  const autonomyEnabled = opts.ai?.autonomy ?? false
  const requireApproval = opts.security?.requireToolApproval ?? false
  const libraryToolAccess: AiLibraryToolAccess =
    opts.security?.libraryToolAccess ??
    (opts.security?.readOnlyTools ? "vision_only" : "full")
  const folderMutationsOk = libraryAllowsFolderMutations(libraryToolAccess)
  const toolMode: ToolMode = !agentEnabled
    ? false
    : libraryToolAccess === "vision_only"
      ? "read-only"
      : libraryToolAccess === "sandbox"
        ? "sandbox"
        : "all"

  const messages = [...opts.messages]
  let totalIn = 0
  let totalOut = 0
  const thinkingSupported = await ollamaModelSupportsThinking({
    baseUrl,
    apiKey: apiKey ?? null,
    model,
  })

  if (opts.disableTools) {
    await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
    return
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  const priorUserTexts = messages.filter((m) => m.role === "user").map((m) => m.content)

  if (lastUser && agentEnabled && !requireApproval) {
    const readArgs = buildSyntheticReadTextAssetArgsFromUser(lastUser.content, priorUserTexts)
    if (readArgs) {
      writeSseEvent(raw, { libraryAction: "read_text_asset", status: "Reading file…" })
      const syntheticCall = {
        function: { name: "read_text_asset" as const, arguments: readArgs },
      }
      const result = await executeArciinChatTool(syntheticCall, toolCtx)
      messages.push({ role: "assistant", content: " ", tool_calls: [syntheticCall] })
      messages.push({ role: "tool", content: JSON.stringify(result) })
      await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
      return
    }

    const pdfArgs = buildSyntheticReadPdfAssetArgsFromUser(
      lastUser.content,
      priorUserTexts,
      messages,
    )
    if (pdfArgs) {
      writeSseEvent(raw, { libraryAction: "read_pdf_asset", status: "Reading PDF…" })
      const syntheticCall = {
        function: { name: "read_pdf_asset" as const, arguments: pdfArgs },
      }
      const result = await executeArciinChatTool(syntheticCall, toolCtx)
      messages.push({ role: "assistant", content: " ", tool_calls: [syntheticCall] })
      messages.push({ role: "tool", content: JSON.stringify(result) })
      await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
      return
    }
  }

  if (lastUser && agentEnabled && folderMutationsOk && !requireApproval) {
    const delArgs = buildSyntheticDeleteLibraryFolderArgsFromUser(lastUser.content)
    if (delArgs) {
      writeSseEvent(raw, { libraryAction: "delete_library_folder", status: "Updating folders…" })
      const syntheticCall = {
        function: { name: "delete_library_folder" as const, arguments: delArgs },
      }
      const result = await executeArciinChatTool(syntheticCall, toolCtx)
      messages.push({ role: "assistant", content: " ", tool_calls: [syntheticCall] })
      messages.push({ role: "tool", content: JSON.stringify(result) })
      await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
      return
    }
    const createArgs = buildSyntheticCreateLibraryFolderArgsFromUser(lastUser.content)
    if (createArgs) {
      writeSseEvent(raw, { libraryAction: "create_library_folder", status: "Creating folder…" })
      const syntheticCall = {
        function: { name: "create_library_folder" as const, arguments: createArgs },
      }
      const result = await executeArciinChatTool(syntheticCall, toolCtx)
      messages.push({ role: "assistant", content: " ", tool_calls: [syntheticCall] })
      messages.push({ role: "tool", content: JSON.stringify(result) })
      await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
      return
    }
  }

  let libraryIntent = lastUser ? detectLibraryToolIntent(lastUser.content) : null
  if (libraryIntent === "organize_images_library" && libraryToolAccess !== "full") {
    libraryIntent = null
  }

  if (libraryIntent && lastUser && agentEnabled && autonomyEnabled && !requireApproval) {
    writeSseEvent(raw, { libraryAction: libraryIntent, status: "Searching your library…" })

    const args = toolArgsForIntent(libraryIntent, lastUser.content)
    const syntheticCall = {
      function: { name: libraryIntent, arguments: args },
    }
    const result = await executeArciinChatTool(syntheticCall, toolCtx)

    messages.push({
      role: "assistant",
      content: " ",
      tool_calls: [syntheticCall],
    })
    messages.push({
      role: "tool",
      content: JSON.stringify(result),
    })

    await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
    return
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await ollamaChatOnce(baseUrl, model, messages, {
      stream: true,
      tools: toolMode,
      apiKey,
      thinkingSupported,
    })

    if (!res.body) {
      throw new Error("Provider error: empty response body from Ollama.")
    }

    const toolsActive = toolMode !== false
    const collected = await collectStreamedOllama(res, raw, {
      thinking: thinkingSupported,
      text: !toolsActive,
    })
    totalIn += collected.usage?.inputTokens ?? 0
    totalOut += collected.usage?.outputTokens ?? 0

    const toolCalls = collected.tool_calls
    if (!toolCalls?.length) {
      const answer = (collected.content ?? "").trim()
      const thinking =
        (typeof collected.thinking === "string" ? collected.thinking : "").trim() ||
        (typeof collected.thought === "string" ? collected.thought : "").trim()

      // Detect narrated-but-not-executed folder mutations BEFORE streaming the
      // narration — otherwise the client shows "I've created it" for a folder
      // that never existed. When one is found, execute it and stream a final
      // answer grounded in the real tool result instead of the narration.
      const combined = `${answer}\n${thinking}`
      if (agentEnabled && folderMutationsOk && !requireApproval) {
        const pseudo = extractBracketPseudoToolCalls(combined)
        const prose = extractProseLibraryFolderMutations(combined)
        let actions = [...pseudo, ...prose].filter(
          (p) => p.name === "delete_library_folder" || p.name === "create_library_folder",
        )

        // The model claimed it acted but its prose has no parseable name/library —
        // fall back to args parsed from the user's own request.
        if (actions.length === 0 && lastUser) {
          const claimed = assistantClaimsFolderMutation(combined)
          if (claimed === "create") {
            const args = buildSyntheticCreateLibraryFolderArgsFromUser(lastUser.content)
            if (args) actions = [{ name: "create_library_folder", arguments: args }]
          } else if (claimed === "delete") {
            const args = buildSyntheticDeleteLibraryFolderArgsFromUser(lastUser.content)
            if (args) actions = [{ name: "delete_library_folder", arguments: args }]
          }
        }

        const first = actions[0]
        if (first) {
          const syntheticCall = { function: { name: first.name, arguments: first.arguments } }
          writeSseEvent(raw, { libraryAction: first.name, status: "Updating library…" })
          const toolResult = await executeArciinChatTool(syntheticCall, toolCtx)
          messages.push({
            role: "assistant",
            content: answer || thinking,
            tool_calls: [syntheticCall],
          })
          messages.push({ role: "tool", content: JSON.stringify(toolResult) })
          await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
          return
        }
      }

      if (toolsActive && answer) {
        writeSseEvent(raw, { text: answer })
      }

      // Some thinking models leave `content` empty and put the user-visible reply in `thinking`.
      if (!answer && thinking) {
        writeSseEvent(raw, { text: thinking })
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
      content: (collected.content ?? "").trim() || " ",
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      if (!agentEnabled) break
      const toolName = call.function?.name
      if (toolName) {
        writeSseEvent(raw, {
          libraryAction: toolName,
          status: toolName ? `Running ${toolName.replace(/_/g, " ")}…` : "Running tool…",
        })
      }
      const result = await executeArciinChatTool(call, toolCtx)
      messages.push({
        role: "tool",
        content: JSON.stringify(result),
      })
    }
  }

  writeSseEvent(raw, { status: "Writing answer…" })
  await streamFinalAnswer(raw, baseUrl, model, messages, totalIn, totalOut, apiKey, thinkingSupported)
}
