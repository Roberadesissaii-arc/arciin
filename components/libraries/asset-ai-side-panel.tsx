"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Send, Sparkles, X } from "lucide-react"

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
  const name = asset.originalFilename
  const isPdf = /\.pdf$/i.test(name) || asset.mimeType === "application/pdf"
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
    `What does ${name} do?`,
    "Explain this in simple terms",
    "Are there any issues or risks?",
  ]
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
        "flex h-full min-h-0 w-full max-w-[400px] shrink-0 flex-col border-l border-zinc-800 bg-[#09090b] text-white",
        className,
      )}
      aria-label="Ask Arciin about this file"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-[#ff4f12]" />
          <p className="truncate text-[13px] font-semibold">Ask Arciin</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
          aria-label="Close assistant panel"
        >
          <X className="size-4" />
        </button>
      </header>

      <div ref={scrollRef} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <p className="text-[22px] font-bold leading-tight tracking-tight text-white">
              Hey {userName}, what do you want to know about this file?
            </p>
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-[11px] text-zinc-400">
              Arciin · {asset.originalFilename}
              {pdfPage ? ` · page ${pdfPage}` : ""}
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!profile || streaming}
                  onClick={() => void sendMessage(s)}
                  className="rounded-2xl border border-zinc-700/80 bg-zinc-900 px-3.5 py-2.5 text-left text-[12.5px] text-zinc-200 transition-colors hover:border-[#ff4f12]/40 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            {!profile && !profilesQuery.isLoading ? (
              <p className="text-[11px] text-zinc-500">
                Add an AI model under Models to use Ask Arciin.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "ml-6 bg-[#ff4f12]/15 text-zinc-100"
                    : "mr-2 bg-zinc-900 text-zinc-200",
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

      <footer className="shrink-0 border-t border-zinc-800 p-3">
        <form
          className="flex items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage(input)
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder="Ask about this file…"
            disabled={!profile || streaming}
            className="max-h-24 min-h-[2.5rem] min-w-0 flex-1 resize-none bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={!profile || streaming || !input.trim()}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ff4f12] text-white disabled:opacity-40"
            aria-label="Send"
          >
            {streaming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </form>
      </footer>
    </aside>
  )
}
