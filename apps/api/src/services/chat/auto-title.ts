import type { PrismaClient } from "@prisma/client"

import { decryptModelApiKey } from "@/services/security/model-profile-key-crypto"

/**
 * Short, human titles for chat conversations.
 *
 * History used to store the first 80 characters of whatever the user typed, so
 * the sidebar filled up with "How many images do I have? Just the numb…" — the
 * question, not the subject. This asks the model for a title instead, and falls
 * back to a tidied-up version of the question when the provider is unreachable
 * or slow, so a conversation is never left untitled.
 */

/** Titles are glanced at in a narrow rail; anything longer just truncates. */
const MAX_TITLE_LEN = 48

const TITLE_PROMPT =
  "Write a title for this conversation in 3 to 6 words. " +
  "Describe the subject, not the question — no leading verb like 'How to', " +
  "no quotes, no trailing punctuation, no markdown. Reply with the title only."

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  grok: "https://api.x.ai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
}

const OLLAMA_PROVIDERS = new Set(["ollama", "ollama-local", "ollama-cloud"])

/** Strip the decoration models like to add, and cap the length. */
export function cleanTitle(raw: string): string {
  let out = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ""

  out = out
    .replace(/^["'`*#\s]+|["'`*\s]+$/g, "")
    .replace(/^(?:title|subject)\s*:\s*/i, "")
    .replace(/[.。!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim()

  if (out.length > MAX_TITLE_LEN) {
    out = out.slice(0, MAX_TITLE_LEN).replace(/\s+\S*$/, "") + "…"
  }
  return out
}

/**
 * Last resort when the model cannot be reached: the user's own words, trimmed
 * of the question framing so the rail still reads as a subject.
 */
export function fallbackTitle(userText: string): string {
  const stripped = userText
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(?:can you|could you|please|hey|hi|hello|so|ok|okay|i want you to|i need you to|tell me|show me|give me|what is|what are|whats|what's|how do i|how to|how many|why is|why are|who is|when is|where is)\s+/i,
      "",
    )
    .replace(/^[,\s]+/, "")
  const base = stripped || userText.trim()
  const capped = base.charAt(0).toUpperCase() + base.slice(1)
  return cleanTitle(capped) || "New conversation"
}

type TitleProfile = {
  provider: string
  apiKey: string | null
  baseUrl: string | null
  defaultModel: string | null
}

/** One short, non-streaming completion. Returns null rather than throwing. */
async function requestTitle(
  profile: TitleProfile,
  model: string,
  exchange: string,
): Promise<string | null> {
  // Title generation must never hold up the UI or cost real money if it hangs.
  const signal = AbortSignal.timeout(15_000)

  try {
    if (profile.provider === "anthropic") {
      if (!profile.apiKey) return null
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": profile.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          system: TITLE_PROMPT,
          messages: [{ role: "user", content: exchange }],
        }),
        signal,
      })
      if (!res.ok) return null
      const data = (await res.json()) as { content?: { text?: string }[] }
      return data.content?.map((c) => c.text ?? "").join("") ?? null
    }

    if (OLLAMA_PROVIDERS.has(profile.provider)) {
      const base = (
        profile.baseUrl ??
        (profile.provider === "ollama-cloud" ? "https://ollama.com" : "http://localhost:11434")
      )
        .replace(/\/v1\/?$/, "")
        .replace(/\/$/, "")
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (profile.apiKey?.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          options: { num_predict: 32 },
          messages: [
            { role: "system", content: TITLE_PROMPT },
            { role: "user", content: exchange },
          ],
        }),
        signal,
      })
      if (!res.ok) {
        console.warn(
          `[auto-title] ${profile.provider} rejected the request (HTTP ${res.status}); falling back to the user's words`,
        )
        return null
      }
      const data = (await res.json()) as { message?: { content?: string } }
      return data.message?.content ?? null
    }

    // Everything else speaks the OpenAI-compatible shape.
    const base = (profile.baseUrl ?? PROVIDER_BASE_URLS[profile.provider] ?? "").replace(/\/$/, "")
    if (!base || !profile.apiKey) {
      // Silently returning null here is why every conversation kept its raw
      // first message: the fallback looks identical to a working title.
      console.warn(
        `[auto-title] ${profile.provider} has no ${!base ? "base URL" : "API key"}; cannot generate a title`,
      )
      return null
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        // Reasoning models spend this budget on reasoning_content and return
        // an empty content field: deepseek-v4-flash produced 1,049 characters
        // of reasoning and no answer at 256, so a title needs real headroom.
        max_tokens: 1024,
        messages: [
          { role: "system", content: TITLE_PROMPT },
          { role: "user", content: exchange },
        ],
      }),
      signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      console.warn(
        `[auto-title] ${profile.provider}/${model} rejected the request (HTTP ${res.status}) ${detail.slice(0, 160)}`,
      )
      return null
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[]
    }
    const message = data.choices?.[0]?.message
    const content = message?.content?.trim()
    if (content) return content

    // A reasoning model that ran out of budget leaves content empty. Its
    // reasoning usually ends with the title it was about to give, so take the
    // last non-empty line rather than falling back to the user's own words.
    const reasoning = message?.reasoning_content?.trim()
    if (!reasoning) return null
    const lastLine = reasoning.split("\n").map((l) => l.trim()).filter(Boolean).at(-1)
    return lastLine ?? null
  } catch (error) {
    // Includes the 15s timeout. Worth naming: a title that never arrives is
    // indistinguishable from one that arrived and was ignored.
    console.warn(
      `[auto-title] ${profile.provider} request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

/**
 * Give a conversation a real title based on its opening exchange.
 *
 * Safe to call more than once: it only writes when it produces something, and
 * the caller decides whether the existing title deserves replacing.
 */
export async function generateConversationTitle(input: {
  prisma: PrismaClient
  conversationId: string
  userText: string
  assistantText: string
}): Promise<string> {
  const { prisma, conversationId, userText, assistantText } = input

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { profileId: true },
  })

  const profile = conversation?.profileId
    ? await prisma.modelProfile.findUnique({ where: { id: conversation.profileId } })
    : ((await prisma.modelProfile.findFirst({ where: { isDefault: true, isEnabled: true } })) ??
      (await prisma.modelProfile.findFirst({ where: { isEnabled: true } })))

  let title = ""
  const model = profile?.defaultModel?.trim()
  if (profile && model) {
    // Keys are stored encrypted. Passing the ciphertext straight through as a
    // bearer token made every provider answer 401, requestTitle return null,
    // and the fallback — the user's own first message — become the title. That
    // is why every conversation in the rail was named after its opening line.
    const keyed = { ...profile, apiKey: decryptModelApiKey(profile.apiKey) }
    const exchange =
      `User: ${userText.slice(0, 600)}\n\n` + `Assistant: ${assistantText.slice(0, 600)}`
    const raw = await requestTitle(keyed, model, exchange)
    if (raw) title = cleanTitle(raw)
  }

  if (!title) title = fallbackTitle(userText)

  await prisma.chatConversation.update({
    where: { id: conversationId },
    data: { title },
  })
  return title
}
