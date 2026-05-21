"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Mic, Plus, SendHorizontal, Sparkles, X } from "lucide-react"

import { fetchApi } from "@/lib/api/client"
import {
  getChatStreamPostUrl,
  type ChatFocusAsset,
} from "@/lib/api/chat"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

type ChatProfile = {
  id: string
  displayName: string
  provider: string
  defaultModel: string | null
  isEnabled: boolean
}

const ASSET_CHAT_SYSTEM = `You help with the file the user has open in Arciin library preview. Use the focused file content in this conversation. For PDFs, cite page numbers from --- Page N --- markers. Be concise and accurate.`

type PanelMessage = { id: string; role: "user" | "assistant"; content: string }

function suggestionsFor(asset: AssetSummary, page?: number): string[] {
  const isPdf = /\.pdf$/i.test(asset.originalFilename) || asset.mimeType === "application/pdf"
  if (isPdf) {
    return [
      "Summarize this document",
      page ? `What is on page ${page}?` : "Which page mentions refunds or policy?",
      "List the main sections",
    ]
  }
  if (asset.mediaType === "IMAGE") {
    return ["Describe this image", "What text is visible?", "Suggest a title for this file"]
  }
  return [
    "Explain what this file does",
    "Summarize in simple terms",
    "Are there any issues or risks?",
  ]
}

function truncateFilename(name: string, max = 36) {
  if (name.length <= max) return name
  return `${name.slice(0, max - 1)}…`
}

export function AssetAiSidePanel({
  asset,
  pdfPage,
  onClose,
  className,
}: {
  asset: AssetSummary
  pdfPage?: number
  onClose: () => void
  className?: string
}) {
  const meQuery = useAuth()
  const userName = meQuery.data?.user.name?.split(/\s+/)[0] ?? "there"

  const profilesQuery = useQuery({
    queryKey: queryKeys.chatProfiles,
    queryFn: ({ signal }) =>
      fetchApi<ChatProfile[]>("/chat/profiles", { signal }) as Promise<ChatProfile[]>,
  })

  const profile =
    profilesQuery.data?.find((p) => p.isEnabled) ?? profilesQuery.data?.[0] ?? null

  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const focus = useMemo<ChatFocusAsset>(
    () => ({
      assetId: asset.id,
      ...(pdfPage && pdfPage > 0 ? { currentPage: pdfPage } : {}),
    }),
    [asset.id, pdfPage],
  )

  const suggestions = suggestionsFor(asset, pdfPage)
  const contextLabel = `Arciin · ${truncateFilename(asset.originalFilename)}${
    pdfPage ? ` · page ${pdfPage}` : ""
  }`

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, streaming])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streaming || !profile) return

      const userMsg: PanelMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed }
      const assistantId = `a-${Date.now()}`
      setMessages((m) => [...m, userMsg, { id: assistantId, role: "assistant", content: "" }])
      setInput("")
      setStreaming(true)

      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      abortRef.current?.abort()
      abortRef.current = new AbortController()

      try {
        const res = await fetch(getChatStreamPostUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            profileId: profile.id,
            model: profile.defaultModel ?? undefined,
            focusAsset: focus,
            messages: [
              { role: "system", content: ASSET_CHAT_SYSTEM },
              ...history,
            ],
          }),
          signal: abortRef.current.signal,
        })

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: { message: "Request failed" } }))
          throw new Error(err?.error?.message ?? "Chat failed")
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let accumulated = ""

        while (true) {
          const { done, value } = await reader.read()
          if (value) buffer += decoder.decode(value, { stream: true })
          if (done) buffer += decoder.decode()
          const lines = buffer.split("\n")
          buffer = done ? "" : (lines.pop() ?? "")
          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine.startsWith("data:")) continue
            const payload = trimmedLine.slice(5).trim()
            if (payload === "[DONE]") continue
            try {
              const json = JSON.parse(payload) as { error?: string; text?: string }
              if (json.error) throw new Error(json.error)
              if (json.text) {
                accumulated += json.text
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === assistantId ? { ...msg, content: accumulated } : msg,
                  ),
                )
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr
              }
            }
          }
          if (done) break
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return
        const msg = err instanceof Error ? err.message : "Something went wrong"
        setMessages((m) =>
          m.map((item) =>
            item.id === assistantId ? { ...item, content: msg } : item,
          ),
        )
      } finally {
        setStreaming(false)
      }
    },
    [focus, messages, profile, streaming],
  )

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col",
        "border-l border-white/[0.08]",
        "bg-[linear-gradient(180deg,#1e1e22_0%,#141416_55%,#111113_100%)]",
        "text-white shadow-[-12px_0_40px_rgba(0,0,0,0.35)]",
        className,
      )}
      aria-label="Ask Arciin about this file"
    >
      <div className="flex shrink-0 items-center justify-end gap-0.5 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setMessages([])}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 hover:bg-white/6 hover:text-zinc-200"
        >
          New chat
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/6 hover:text-white"
          aria-label="Close assistant panel"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={scrollRef} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-5 pt-2">
            <h2
              className="text-[26px] font-semibold leading-[1.2] tracking-tight text-white"
              style={{ fontFamily: "var(--font-space-grotesk, sans-serif)" }}
            >
              Hey {userName}, what do you want to know about this file?
            </h2>

            <button
              type="button"
              className="w-fit max-w-full rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-left text-[12px] text-zinc-300 transition-colors hover:bg-white/[0.09]"
            >
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3 shrink-0 text-[#ff4f12]" />
                <span className="truncate">{contextLabel}</span>
              </span>
            </button>

            <div className="flex flex-col gap-2.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!profile || streaming}
                  onClick={() => void sendMessage(s)}
                  className="rounded-[14px] border border-white/[0.12] bg-white/[0.04] px-4 py-3 text-left text-[13px] leading-snug text-zinc-100 transition-colors hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-45"
                >
                  {s}
                </button>
              ))}
            </div>

            {!profile && !profilesQuery.isLoading ? (
              <p className="text-[12px] leading-relaxed text-zinc-500">
                Add a model under Models to chat about this file.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "ml-4 border border-[#ff4f12]/25 bg-[#ff4f12]/10 text-zinc-50"
                    : "mr-1 border border-white/[0.08] bg-white/[0.04] text-zinc-200",
                )}
              >
                {m.content || (streaming && m.role === "assistant" ? (
                  <Loader2 className="size-4 animate-spin text-[#ff4f12]" />
                ) : null)}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="shrink-0 px-4 pb-4 pt-2">
        <form
          className="overflow-hidden rounded-[18px] border border-white/[0.1] bg-[#2a2a2f] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage(input)
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="Message Arciin about this file…"
            disabled={!profile || streaming}
            className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[13px] leading-relaxed text-white outline-none placeholder:text-zinc-500"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
              aria-label="Attach"
              tabIndex={-1}
            >
              <Plus className="size-4" />
            </button>
            <div className="flex items-center gap-1">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                Smart
              </span>
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
                aria-label="Voice input"
                tabIndex={-1}
              >
                <Mic className="size-4" />
              </button>
              <button
                type="submit"
                disabled={!profile || streaming || !input.trim()}
                className="flex size-8 items-center justify-center rounded-full bg-[#ff4f12] text-white transition-opacity disabled:opacity-35"
                aria-label="Send"
              >
                {streaming ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SendHorizontal className="size-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </footer>
    </aside>
  )
}
