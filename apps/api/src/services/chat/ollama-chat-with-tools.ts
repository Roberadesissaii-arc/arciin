import {
  parseDsmlToolCalls,
  splitStreamableText,
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
import {
  buildSyntheticReadPdfAssetArgsFromUser,
  extractQuotedOrNamedFilename,
} from "@/services/chat/read-pdf-asset-synthetic"
import { buildSyntheticReadTextAssetArgsFromUser } from "@/services/chat/read-text-asset-synthetic"
import { normalizeOllamaCloudModelId } from "@/services/chat/ollama-cloud-models"
import {
  OLLAMA_REQUEST_TIMEOUT_MS,
  formatOllamaProviderError,
  ollamaAuthHeaders,
  ollamaFetch,
} from "@/services/chat/ollama-http"
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

/**
 * Tools whose work is inherently iterative, and the budget they get.
 *
 * Four rounds is right for a question that needs a lookup or two. It is not
 * enough to organise a library: enumerating 245 documents is three paginated
 * calls before a single file has moved, and the moves themselves are batched.
 * A run that hits the ceiling stops mid-job and reads to the user exactly like
 * the old failure — folders created, files left where they were.
 *
 * So the budget is raised only once one of these tools has actually been
 * called. An ordinary turn keeps the tight bound and cannot spin; a paging,
 * batching job gets the room it genuinely needs, still bounded.
 */
const ITERATIVE_FILE_TOOLS = new Set([
  "list_library_files",
  "move_library_files",
  "create_library_folder",
])
const MAX_FILE_ORGANIZE_ROUNDS = 24

/** Strip "you must call read_pdf_asset" instructions once the server already loaded the file. */
function stripPendingToolInstructions(text: string): string {
  return text
    .replace(
      /You MUST use read_pdf_asset or read_text_asset[\s\S]*?(?=\n\n|$)/gi,
      "The file text has already been loaded by Arciin for this turn.",
    )
    .replace(/\bMUST call read_pdf_asset\b/gi, "use the loaded source text")
    .replace(/\buse read_pdf_asset or read_text_asset with that exact filename\/id before\b/gi, "use the already-loaded source text when")
    .replace(/Never print tool_call XML or JSON in the user-visible answer\./gi, "")
    .trim()
}

function isEssayOrLongFormRequest(userText: string): boolean {
  return /\b(essay|article|report|exam|quiz|study\s+guide|documentation|outline|write\s+(?:me\s+)?(?:an?\s+)?(?:essay|article)|what\s+this\s+book\s+is\s+about|what\s+(?:is\s+)?(?:this|the)\s+book\s+about)\b/i.test(
    userText,
  )
}

/**
 * After a PDF/text read tool runs, rebuild the message list so the model sees
 * clear SOURCE TEXT and never plans another tool call.
 */
function buildMessagesAfterFileRead(opts: {
  messages: ChatMsg[]
  toolName: "read_pdf_asset" | "read_text_asset"
  toolResult: Record<string, unknown>
  userRequest: string
}): ChatMsg[] {
  const { toolResult, toolName, userRequest } = opts
  const out: ChatMsg[] = []

  for (const m of opts.messages) {
    if (m.role === "tool") continue
    if (m.role === "assistant" && m.tool_calls?.length) continue
    if (m.role === "system" && /tool result above|PDF text is already|file contents are already/i.test(m.content)) {
      continue
    }
    if (m.role === "user") {
      out.push({ role: "user", content: stripPendingToolInstructions(m.content) })
      continue
    }
    out.push({ ...m, content: (m.content ?? "").trim() || " " })
  }

  const filename =
    typeof toolResult.filename === "string" ? toolResult.filename : "attached file"
  const err =
    typeof toolResult.error === "string"
      ? String(toolResult.message ?? toolResult.error)
      : null
  const body =
    typeof toolResult.content === "string"
      ? toolResult.content
      : err
        ? `(Could not read file: ${err})`
        : JSON.stringify(toolResult)

  const essay = isEssayOrLongFormRequest(userRequest)
  const task = essay
    ? [
        "Write a FULL multi-section essay about this book (what it is about, main themes, and takeaways).",
        "Required structure:",
        "# Title",
        "## Introduction",
        "## What the book is about",
        "## Main themes (2–4 ## or ### sections)",
        "## Conclusion",
        "## References",
        "Aim for roughly 800–1500 words. Ground every claim in the SOURCE TEXT below.",
        "Start immediately with `# Title`. Do NOT say you will read the PDF. Do NOT print tool calls.",
      ].join("\n")
    : [
        "Answer the user completely using the SOURCE TEXT below.",
        "Do NOT say you will open or read the file — it is already loaded.",
        "Do NOT print tool_call XML/JSON or [[ASSETS:…]] tags.",
      ].join("\n")

  out.push({
    role: "user",
    content:
      `[SOURCE ${toolName === "read_pdf_asset" ? "PDF" : "FILE"} TEXT — ALREADY LOADED BY ARCIIN]\n` +
      `Filename: ${filename}\n` +
      `The following text was extracted from the attached file. Use it as your only source.\n\n` +
      `${body.slice(0, 28_000)}\n\n` +
      `---\n` +
      `User request:\n${stripPendingToolInstructions(userRequest).split("[USER ATTACHED FILE")[0]!.trim()}\n\n` +
      `${task}`,
  })

  return out
}

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
          content:
            `Tool results are ALREADY LOADED below. Write the final answer now. ` +
            `Do not plan to search, open, or read anything else.\n\n` +
            toolPayloads.map((p, idx) => `--- Result ${idx + 1} ---\n${p}`).join("\n\n"),
        })
      }
      i = j - 1
      continue
    }
    if (m.role === "tool") continue
    const content = (m.content ?? "").trim()
    out.push({
      ...m,
      content: m.role === "user" ? stripPendingToolInstructions(content) || " " : content || " ",
    })
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

function resolveOllamaTools(mode: ToolMode, withheld?: ReadonlySet<string>) {
  if (mode === false) return undefined
  const allowed = withheld?.size
    ? ARCIIN_CHAT_TOOLS.filter((t) => !withheld.has(t.function.name))
    : ARCIIN_CHAT_TOOLS
  if (mode === "read-only") {
    return allowed.filter((t) => t.function.name === "vision_search_library")
  }
  if (mode === "sandbox") {
    // Sandbox means "you may shape folders, but you may not shuffle the user's
    // files into them". Both bulk-move tools are withheld, not just the image
    // one — moving books is the same power wearing a different name.
    return allowed.filter(
      (t) =>
        t.function.name !== "organize_images_library" &&
        t.function.name !== "move_library_files",
    )
  }
  return allowed
}

async function ollamaChatOnce(
  baseUrl: string,
  model: string,
  messages: ChatMsg[],
  opts: {
    stream: boolean
    tools?: ToolMode
    withheldTools?: ReadonlySet<string>
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
    const tools =
      opts.tools === undefined ? undefined : resolveOllamaTools(opts.tools, opts.withheldTools)
    if (tools?.length) body.tools = tools
    return body
  }

  const post = (thinkValue: boolean | string) =>
    // Not the global fetch: the AbortSignal alone does not raise undici's own
    // 300s headers/body timeouts, so without this the ceiling below is fiction.
    ollamaFetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: ollamaAuthHeaders(opts.apiKey),
      body: JSON.stringify(buildBody(thinkValue)),
      signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
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
          // Withhold a trailing fragment that might still become a control
          // token. Once emitted, a half-written `<｜｜DSM` cannot be recalled.
          const { safe } = splitStreamableText(accumulatedContent)
          prevContent = writeSseDelta(raw, "text", safe, prevContent)
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

  // The stream is over, so nothing is partial any more: emit whatever the
  // fragment guard was holding, sanitised.
  if (forward.text) {
    writeSseDelta(raw, "text", accumulatedContent, prevContent)
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
  /** Tool names to withhold for this turn (Canvas turns hide the store writers). */
  withheldTools?: ReadonlySet<string>
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

  // Read-only synthetic file loads ALWAYS run (even when Agent is off / approval is on).
  // Attached books + "write an essay" must never depend on the model inventing tool_call XML.
  if (lastUser) {
    const readArgs = buildSyntheticReadTextAssetArgsFromUser(lastUser.content, priorUserTexts)
    if (readArgs) {
      writeSseEvent(raw, { libraryAction: "read_text_asset", status: "Reading file…" })
      const syntheticCall = {
        function: { name: "read_text_asset" as const, arguments: readArgs },
      }
      const result = (await executeArciinChatTool(syntheticCall, toolCtx)) as Record<string, unknown>
      const finalMessages = buildMessagesAfterFileRead({
        messages,
        toolName: "read_text_asset",
        toolResult: result,
        userRequest: lastUser.content,
      })
      await streamFinalAnswer(raw, baseUrl, model, finalMessages, totalIn, totalOut, apiKey, thinkingSupported)
      return
    }

    let pdfArgs = buildSyntheticReadPdfAssetArgsFromUser(
      lastUser.content,
      priorUserTexts,
      messages,
    )

    // Snapshot miss: resolve the named PDF directly from the database.
    if (!pdfArgs) {
      const named = extractQuotedOrNamedFilename(lastUser.content)
      if (named && /\.pdf$/i.test(named)) {
        const hit = await toolCtx.prisma.asset.findFirst({
          where: {
            deletedAt: null,
            mediaType: "DOCUMENT",
            originalFilename: { equals: named, mode: "insensitive" },
          },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
        })
        if (hit) pdfArgs = { asset_id: hit.id }
      }
    }

    // Attached id fallback when content-question heuristics missed.
    if (!pdfArgs) {
      const attachedId = lastUser.content.match(/\(id\s*=\s*(c[a-z0-9]{20,})\)/i)?.[1]
      if (
        attachedId &&
        (/\.pdf\b/i.test(lastUser.content) || /USER ATTACHED FILE/i.test(lastUser.content)) &&
        isEssayOrLongFormRequest(lastUser.content)
      ) {
        pdfArgs = { asset_id: attachedId }
      }
    }

    if (pdfArgs) {
      writeSseEvent(raw, { libraryAction: "read_pdf_asset", status: "Reading PDF…" })
      const essay = isEssayOrLongFormRequest(lastUser.content)
      const syntheticCall = {
        function: {
          name: "read_pdf_asset" as const,
          // Longer extract for essays so the model has enough book substance.
          arguments: {
            ...pdfArgs,
            max_chars: essay ? 24_000 : 14_000,
            max_pages: essay ? 80 : 60,
          },
        },
      }
      const result = (await executeArciinChatTool(syntheticCall, toolCtx)) as Record<
        string,
        unknown
      >
      if (result.error) {
        writeSseEvent(raw, {
          status: `Could not read PDF (${String(result.message ?? result.error)})`,
        })
      }
      // Rebuild history with clear SOURCE TEXT — models ignore vague "tool already ran" notes.
      const finalMessages = buildMessagesAfterFileRead({
        messages,
        toolName: "read_pdf_asset",
        toolResult: result,
        userRequest: lastUser.content,
      })
      await streamFinalAnswer(raw, baseUrl, model, finalMessages, totalIn, totalOut, apiKey, thinkingSupported)
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

  /** Raised the first time an inherently iterative file tool is used. */
  let toolRoundBudget = MAX_TOOL_ROUNDS

  /**
   * What a recovered call is allowed to be.
   *
   * Only tools this turn was actually offered. A model that invents a name in
   * prose must not be able to reach anything the tool gate withheld.
   */
  const allowedToolNames = new Set(
    (resolveOllamaTools(toolMode, opts.withheldTools) ?? []).map((t) => t.function.name),
  )

  for (let round = 0; round < toolRoundBudget; round++) {
    const res = await ollamaChatOnce(baseUrl, model, messages, {
      stream: true,
      tools: toolMode,
      withheldTools: opts.withheldTools,
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

    /**
     * A tool call the model wrote into its reply instead of the tool field.
     *
     * DeepSeek sometimes emits its DSML invocation as content. Without this the
     * call is simply lost: the reader saw the raw markup and the tool never
     * ran. Recovering it means the request the model actually made is honoured,
     * and the markup is stripped from what they see either way.
     */
    // Content *and* reasoning: DeepSeek puts a whole final turn — narration and
    // invocation together — in the thinking channel, which is where the
    // observed leak actually came from.
    const recoverySource = `${collected.content ?? ""}\n${
      (typeof collected.thinking === "string" ? collected.thinking : "") ||
      (typeof collected.thought === "string" ? collected.thought : "")
    }`
    const recoveredCalls =
      !collected.tool_calls?.length && agentEnabled
        ? parseDsmlToolCalls(recoverySource)
            .filter((c) => allowedToolNames.has(c.name))
            .map((c) => ({ function: { name: c.name, arguments: c.arguments } }))
        : []

    const toolCalls = collected.tool_calls?.length ? collected.tool_calls : recoveredCalls
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

      /**
       * Sanitised on the way out.
       *
       * These two writes bypass `writeSseDelta`, which is where the stripper
       * lives — so a reply that reached this branch went to the reader exactly
       * as the model wrote it, protocol markup and all. That is how
       * `<｜｜DSML｜｜tool_calls>` ended up in a real transcript.
       */
      const visibleAnswer = stripAssistantStreamMarkup(answer)
      if (toolsActive && visibleAnswer) {
        writeSseEvent(raw, { text: visibleAnswer })
      }

      // Some thinking models leave `content` empty and put the user-visible reply in `thinking`.
      if (!visibleAnswer && thinking) {
        const visibleThinking = stripAssistantStreamMarkup(thinking)
        if (visibleThinking) writeSseEvent(raw, { text: visibleThinking })
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
      if (toolName && ITERATIVE_FILE_TOOLS.has(toolName)) {
        toolRoundBudget = MAX_FILE_ORGANIZE_ROUNDS
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
