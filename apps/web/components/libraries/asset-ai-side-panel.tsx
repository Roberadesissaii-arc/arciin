"use client"
/* eslint-disable react-hooks/set-state-in-effect -- intentional: sync the picked model to the active provider/asset when they change. */

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Mic, SendHorizontal, Sparkles, Square, X } from "lucide-react"

import {
  ChatModelPicker,
  type ChatProfilePicker,
} from "@/components/chat/chat-model-picker"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getChatSelection,
  getChatStreamPostUrl,
  parseChatHttpError,
  setChatSelection,
  type ChatFocusAsset,
} from "@/lib/api/chat"
import {
  CHAT_SELECTED_MODEL_KEY,
  CHAT_SELECTED_PROFILE_ID_KEY,
} from "@/lib/chat/chat-selection-storage"
import { loadAssetImageBase64 } from "@/lib/chat/load-asset-image-base64"
import { useAssetChatModel } from "@/hooks/use-asset-chat-model"
import { useSpeechToText } from "@/hooks/use-speech-to-text"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuth } from "@/hooks/use-auth"
import { heyTherePhrase, resolveUserGreeting } from "@/lib/user/greeting"
import { parseAssistantHighlights } from "@/lib/files/parse-pdf-highlight-request"
import {
  pointingKeywordsFromUser,
  resolveImageHighlightRegions,
  userWantsImagePointing,
} from "@/lib/files/infer-image-regions-from-prose"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"
import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"
import { stripAssistantStreamMarkup } from "@/lib/chat/strip-stream-markup"
import {
  resolvePdfGotoPage,
  stripGotoPageTags,
} from "@/lib/files/parse-pdf-page-request"
import { assetPreviewChatSystem } from "@/lib/chat/asset-preview-system"
import {
  modelBelongsToProvider,
  resolveModelForProfile,
} from "@/lib/chat/asset-chat-model"
import { findLabelForPdfPage } from "@arciin/shared"
import { usePdfNavigationIndex } from "@/lib/hooks/use-pdf-navigation-index"
import { PreviewChatMessage } from "@/components/libraries/preview-chat-message"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

type PanelMessage = { id: string; role: "user" | "assistant"; content: string }

function suggestionsFor(
  asset: AssetSummary,
  page?: number,
  printedPage?: number,
): string[] {
  const isPdf = /\.pdf$/i.test(asset.originalFilename) || asset.mimeType === "application/pdf"
  if (isPdf) {
    const pageLabel =
      page && printedPage
        ? `What page am I on? (book page ${printedPage}, PDF page ${page})`
        : page
          ? `What page am I on? (PDF page ${page})`
          : "Which page mentions the main topic?"
    return [
      "Summarize this document",
      pageLabel,
      page ? "Highlight the section heading on this page" : "Highlight the About This Book heading",
      page ? "Explain the key ideas on this page" : "List the main sections",
    ]
  }
  if (asset.mediaType === "IMAGE") {
    return [
      "Describe this image",
      "What are the main subjects in this image?",
      "What text is visible?",
      "Summarize this image briefly",
    ]
  }
  return [
    "Explain what this file does",
    "Summarize in simple terms",
    "Are there any issues or risks?",
    "What should I know first?",
  ]
}

function truncateFilename(name: string, max = 36) {
  if (name.length <= max) return name
  return `${name.slice(0, max - 1)}…`
}

export function AssetAiSidePanel({
  asset,
  pdfPage,
  pdfPageCount,
  onNavigateToPage,
  onHighlightPdf,
  onClearPdfHighlight,
  onHighlightImage,
  onClearImageHighlight,
  onNewChat,
  onClose,
  className,
}: {
  asset: AssetSummary
  pdfPage?: number
  pdfPageCount?: number
  onNavigateToPage?: (page: number) => void
  onHighlightPdf?: (targets: PdfHighlightTarget[]) => void
  onClearPdfHighlight?: () => void
  onHighlightImage?: (regions: ImageHighlightRegion[], options?: { replace?: boolean }) => void
  onClearImageHighlight?: () => void
  onNewChat?: () => void
  onClose: () => void
  className?: string
}) {
  const queryClient = useQueryClient()
  const meQuery = useAuth()
  const greeting = resolveUserGreeting({
    isLoading: meQuery.isLoading,
    isOffline: meQuery.isError || !meQuery.data?.user,
    fullName: meQuery.data?.user.name,
  })
  const heyName = heyTherePhrase(greeting)

  const isImageAsset = asset.mediaType === "IMAGE"
  const isPdfAsset =
    /\.pdf$/i.test(asset.originalFilename) || asset.mimeType === "application/pdf"
  const pdfPageIndex = usePdfNavigationIndex(asset.id, isPdfAsset)
  const currentPageLabel = useMemo(
    () =>
      pdfPage && pdfPageIndex?.length
        ? findLabelForPdfPage(pdfPageIndex, pdfPage)
        : undefined,
    [pdfPage, pdfPageIndex],
  )
  const printedPage = currentPageLabel?.printedPage

  const [pickedModel, setPickedModel] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CHAT_SELECTED_MODEL_KEY)
    } catch {
      return null
    }
  })
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CHAT_SELECTED_PROFILE_ID_KEY)
    } catch {
      return null
    }
  })
  const [imageModelUserPicked, setImageModelUserPicked] = useState(false)
  const [prevAssetId, setPrevAssetId] = useState(asset.id)

  if (asset.id !== prevAssetId) {
    setPrevAssetId(asset.id)
    setImageModelUserPicked(false)
    if (isImageAsset) setPickedModel(null)
  }

  const chatModel = useAssetChatModel(asset, {
    preferredModel:
      isImageAsset && !imageModelUserPicked
        ? undefined
        : pickedModel ?? undefined,
    preferredProfileId: pickedProfileId ?? undefined,
  })
  const {
    profiles,
    profile,
    activeModel,
    setupHint,
    visionCapable,
    need,
    loading,
    ollamaShow,
    ollamaShowLoading,
  } = chatModel

  const effectivePickedModel = useMemo(() => {
    if (isImageAsset) {
      if (imageModelUserPicked) return pickedModel?.trim() || null
      if (!loading && activeModel) return activeModel
      return null
    }
    return pickedModel?.trim() || null
  }, [activeModel, imageModelUserPicked, isImageAsset, loading, pickedModel])

  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const speechBaseRef = useRef("")
  const lastGotoRef = useRef<number | null>(null)
  const lastHighlightSigRef = useRef("")
  const lastImageRegionSigRef = useRef("")

  const { listening, supported, error: speechError, toggleListening, stop: stopSpeech } =
    useSpeechToText()

  const focus = useMemo<ChatFocusAsset>(
    () => ({
      assetId: asset.id,
      ...(pdfPage && pdfPage > 0 ? { currentPage: pdfPage } : {}),
    }),
    [asset.id, pdfPage],
  )

  const suggestions = suggestionsFor(asset, pdfPage, printedPage)
  const isPdf =
    /\.pdf$/i.test(asset.originalFilename) || asset.mimeType === "application/pdf"
  const contextLabel = truncateFilename(asset.originalFilename, 42)
  const documentBadgeText = [
    contextLabel,
    pdfPageCount && pdfPageCount > 0 ? `${pdfPageCount} pages` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const footerPageText =
    isPdf && pdfPage && pdfPage > 0
      ? pdfPageCount && pdfPageCount > 0
        ? printedPage !== undefined
          ? `PDF page ${pdfPage} of ${pdfPageCount} · book page ${printedPage}`
          : `PDF page ${pdfPage} of ${pdfPageCount}`
        : printedPage !== undefined
          ? `PDF page ${pdfPage} · book page ${printedPage}`
          : `PDF page ${pdfPage}`
      : isImageAsset
        ? "Image preview · vision model"
        : null

  const pickerProfiles = useMemo<ChatProfilePicker[]>(
    () =>
      profiles.map((p) => ({
        id: p.id,
        provider: p.provider,
        displayName: p.displayName,
        defaultModel: p.defaultModel,
        isDefault: p.isDefault ?? false,
        isEnabled: p.isEnabled,
      })),
    [profiles],
  )

  const pickerProfile: ChatProfilePicker | null = profile
    ? {
        id: profile.id,
        provider: profile.provider,
        displayName: profile.displayName,
        defaultModel: profile.defaultModel,
        isDefault: profile.isDefault ?? false,
        isEnabled: profile.isEnabled,
      }
    : null

  useEffect(() => {
    if (isImageAsset) return
    if (pickedModel && pickedProfileId) return
    void getChatSelection()
      .then((remote) => {
        if (!remote?.profileId) return
        if (!pickedProfileId) setPickedProfileId(remote.profileId)
        if (!pickedModel && remote.model?.trim()) setPickedModel(remote.model.trim())
        try {
          localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, remote.profileId)
          if (remote.model) localStorage.setItem(CHAT_SELECTED_MODEL_KEY, remote.model)
        } catch {
          /* private mode */
        }
      })
      .catch(() => {
        /* local fallback */
      })
  }, [isImageAsset, pickedModel, pickedProfileId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, streaming])

  const pushImageRegions = useCallback(
    (assistantText: string, userText: string, options?: { replace?: boolean }) => {
      if (!onHighlightImage || need !== "vision") return
      if (!userWantsImagePointing(userText)) return

      const imageRegions = resolveImageHighlightRegions(assistantText, {
        preferKeywords: pointingKeywordsFromUser(userText),
        allowProseFallback: true,
        userQuery: userText,
      })
      if (imageRegions.length === 0) return
      const sig = imageRegions
        .map((r) => `${r.label ?? ""}:${r.x1},${r.y1},${r.x2},${r.y2}`)
        .join("|")
      if (sig === lastImageRegionSigRef.current) return
      lastImageRegionSigRef.current = sig
      onHighlightImage(imageRegions, { replace: options?.replace ?? false })
    },
    [need, onHighlightImage],
  )

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      stopSpeech()
    }
  }, [stopSpeech])

  const handleModelSelect = useCallback(
    (p: ChatProfilePicker, model: string) => {
      if (isImageAsset) setImageModelUserPicked(true)
      setPickedProfileId(p.id)
      setPickedModel(model)
      try {
        localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, p.id)
        localStorage.setItem(CHAT_SELECTED_MODEL_KEY, model)
      } catch {
        /* private mode */
      }
      void setChatSelection({ profileId: p.id, model }).then((saved) => {
        queryClient.setQueryData(queryKeys.chatSelection, saved)
      })
    },
    [isImageAsset, queryClient],
  )

  /** Keep model tag aligned with the selected profile (never ministral on Gemini). */
  useEffect(() => {
    if (!isImageAsset || !profile) return
    const current = pickedModel?.trim()
    if (current && modelBelongsToProvider(profile.provider, current)) return
    const next = resolveModelForProfile({
      provider: profile.provider,
      defaultModel: profile.defaultModel,
      need: "vision",
    })
    if (next) setPickedModel(next)
  }, [isImageAsset, pickedModel, profile])

  const runChatStream = useCallback(
    async (historyMessages: PanelMessage[], assistantId: string) => {
      const rawModel = effectivePickedModel || activeModel
      const modelToSend = profile
        ? resolveModelForProfile({
            provider: profile.provider,
            defaultModel: profile.defaultModel,
            override: rawModel,
            need,
          })
        : rawModel
      if (!profile || !modelToSend) return
      if (setupHint) return
      if (need === "vision" && !visionCapable) return

      type OutboundMsg = {
        role: "user" | "assistant" | "system"
        content: string
        images?: string[]
      }

      const history: OutboundMsg[] = historyMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      let systemContent = assetPreviewChatSystem(asset)
      const lastUserText =
        [...historyMessages].reverse().find((m) => m.role === "user")?.content ?? ""
      const wantsPointing = userWantsImagePointing(lastUserText)

      if (need === "vision" && visionCapable) {
        if (wantsPointing) {
          systemContent +=
            profile?.provider === "gemini"
              ? "\n\n[Gemini vision — point/highlight request] Image pixels attached. Describe location in plain text, then append ONE hidden marker ([point-grid] or JSON box_2d). UI hides tags/JSON. Never full-height vertical strips on text columns."
              : "\n\n[Vision — point/highlight request] Image pixels attached. Describe where you found it, then append [point-grid:\"label\",row,col,rows,cols]. UI hides the tag."
        } else {
          systemContent +=
            "\n\n[Vision — general question] Image pixels attached. Answer in plain text only. Do NOT add highlight markers, JSON boxes, or [point-grid] tags — the user did not ask to point or highlight anything."
        }
      }

      const applyImageHighlights = (assistantText: string) => {
        pushImageRegions(assistantText, lastUserText, { replace: true })
      }

      const payload: OutboundMsg[] = [{ role: "system", content: systemContent }, ...history]

      if (need === "vision" && visionCapable) {
        const b64 = await loadAssetImageBase64(asset.id, asset.updatedAt)
        if (b64) {
          for (let i = payload.length - 1; i >= 0; i--) {
            if (payload[i].role === "user") {
              payload[i] = {
                ...payload[i],
                images: [b64],
                content: `${payload[i].content}\n\n(Attached preview image pixels for vision.)`,
              }
              break
            }
          }
        }
      }

      abortRef.current?.abort()
      abortRef.current = new AbortController()

      try {
        const res = await fetch(getChatStreamPostUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            profileId: profile.id,
            model: modelToSend,
            focusAsset: focus,
            messages: payload,
          }),
          signal: abortRef.current.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(await parseChatHttpError(res))
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
            const payloadLine = trimmedLine.slice(5).trim()
            if (payloadLine === "[DONE]") continue
            try {
              const json = JSON.parse(payloadLine) as { error?: string; text?: string }
              if (json.error) throw new Error(json.error)
              if (json.text) {
                accumulated += json.text
                const cleanedAccum = stripAssistantStreamMarkup(accumulated)
                const goto = resolvePdfGotoPage(cleanedAccum, {
                  maxPage: pdfPageCount,
                  pageIndex: pdfPageIndex ?? undefined,
                })
                if (
                  goto &&
                  onNavigateToPage &&
                  lastGotoRef.current !== goto
                ) {
                  lastGotoRef.current = goto
                  onNavigateToPage(goto)
                }
                const highlights = parseAssistantHighlights(cleanedAccum, {
                  maxPage: pdfPageCount,
                  currentPdfPage: pdfPage,
                  pageIndex: pdfPageIndex ?? undefined,
                })
                if (onHighlightPdf && highlights.length > 0) {
                  const sig = highlights
                    .map((h) => `${h.kind ?? "default"}:${h.page}:${h.quote}`)
                    .join("|")
                  if (sig !== lastHighlightSigRef.current) {
                    lastHighlightSigRef.current = sig
                    onHighlightPdf(highlights)
                  }
                }
                const display = stripGotoPageTags(cleanedAccum)
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === assistantId ? { ...msg, content: display } : msg,
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
        const finalText = stripAssistantStreamMarkup(accumulated)
        applyImageHighlights(finalText)
        const display = stripGotoPageTags(finalText)
        setMessages((m) =>
          m.map((msg) => (msg.id === assistantId ? { ...msg, content: display } : msg)),
        )
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
    [
      activeModel,
      effectivePickedModel,
      asset.id,
      asset.updatedAt,
      focus,
      need,
      profile,
      setupHint,
      visionCapable,
      pdfPage,
      pdfPageCount,
      pdfPageIndex,
      onNavigateToPage,
      onHighlightPdf,
      onHighlightImage,
      pushImageRegions,
    ],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streaming) return

      lastGotoRef.current = null
      lastHighlightSigRef.current = ""
      lastImageRegionSigRef.current = ""

      if (need === "vision" && userWantsImagePointing(trimmed)) {
        onClearImageHighlight?.()
      }

      const userMsg: PanelMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed }
      const assistantId = `a-${Date.now()}`
      const history = [...messages, userMsg]
      setMessages([...history, { id: assistantId, role: "assistant", content: "" }])
      setInput("")
      setStreaming(true)
      await runChatStream(history, assistantId)
    },
    [messages, need, onClearImageHighlight, runChatStream, streaming],
  )

  const regenerateAssistant = useCallback(
    async (assistantId: string) => {
      if (streaming) return
      const aiIdx = messages.findIndex((m) => m.id === assistantId)
      if (aiIdx <= 0) return
      const userMsg = messages[aiIdx - 1]
      if (!userMsg || userMsg.role !== "user") return

      lastGotoRef.current = null
      lastHighlightSigRef.current = ""
      lastImageRegionSigRef.current = ""

      const prior = messages.slice(0, aiIdx)
      const newAssistantId = `a-${Date.now()}`
      setMessages([...prior, { id: newAssistantId, role: "assistant", content: "" }])
      setStreaming(true)
      await runChatStream(prior, newAssistantId)
    },
    [messages, runChatStream, streaming],
  )

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i]!.id
    }
    return null
  }, [messages])

  const displayModel = useMemo(() => {
    const raw = effectivePickedModel || activeModel
    if (!profile) return raw
    return resolveModelForProfile({
      provider: profile.provider,
      defaultModel: profile.defaultModel,
      override: raw,
      need,
    })
  }, [activeModel, effectivePickedModel, need, profile])

  const canSend =
    Boolean(profile && displayModel) &&
    !setupHint &&
    (need !== "vision" || visionCapable)

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
    setMessages([])
    setInput("")
    lastGotoRef.current = null
    lastHighlightSigRef.current = ""
    lastImageRegionSigRef.current = ""
    onClearPdfHighlight?.()
    onClearImageHighlight?.()
    onNewChat?.()
  }, [onClearImageHighlight, onClearPdfHighlight, onNewChat])

  const handleMic = () => {
    if (!supported) return
    speechBaseRef.current = input
    toggleListening((text, isFinal) => {
      const base = speechBaseRef.current
      const merged = isFinal
        ? `${base}${base && !base.endsWith(" ") ? " " : ""}${text.trim()}`
        : `${base}${text}`
      setInput(merged)
      if (isFinal) speechBaseRef.current = merged
    })
  }

  const statusHint =
    loading && !displayModel ? (
      <span className="text-[11px] text-zinc-500">Loading models…</span>
    ) : setupHint ? (
      <span className="text-[11px] leading-snug text-amber-700">{setupHint}</span>
    ) : speechError ? (
      <span className="text-[11px] text-amber-700">{speechError}</span>
    ) : !displayModel ? (
      <span className="text-[11px] text-zinc-500">
        <Link href="/models" className="text-[#ff4f12] hover:underline">
          Models
        </Link>
        {" · "}
        <Link href="/chat" className="text-[#ff4f12] hover:underline">
          AI Chat
        </Link>
      </span>
    ) : null

  const showStatusHint = statusHint !== null

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col",
        "pt-4 pb-4 pl-2 pr-0",
        className,
      )}
      aria-label="Ask Arciin about this file"
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          "rounded-tl-xl rounded-bl-xl border border-zinc-200 border-r-0 bg-white text-zinc-900",
        )}
      >
        <div className="flex shrink-0 items-center justify-end gap-0.5 border-b border-zinc-100 px-3 py-2">
          <button
            type="button"
            onClick={handleNewChat}
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Close assistant panel"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className={cn(
            "scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4",
            messages.length === 0 ? "flex flex-col" : "pb-3 pt-4",
          )}
        >
          {messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 space-y-3 pt-4">
                {heyName ? (
                  <h2
                    className="text-[22px] font-semibold leading-[1.25] tracking-tight text-zinc-900"
                    style={{ fontFamily: "var(--font-space-grotesk, sans-serif)" }}
                  >
                    Hey {heyName}, what do you want to know about this file?
                  </h2>
                ) : (
                  <Skeleton
                    className="h-7 w-[min(100%,18rem)] rounded-lg"
                    style={{ fontFamily: "var(--font-space-grotesk, sans-serif)" }}
                  />
                )}

                <div
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#ff4f12]/25 bg-[#ff4f12]/5 px-3 py-1.5 text-[11px] font-medium text-zinc-600"
                  title={asset.originalFilename}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ff4f12]/15">
                    <Sparkles className="size-3 text-[#ff4f12]" />
                  </span>
                  <span className="truncate">{documentBadgeText}</span>
                </div>

                {showStatusHint ? <div>{statusHint}</div> : null}
              </div>

              <div className="flex flex-1 flex-col items-center justify-center px-1 py-6">
                <div className="grid w-full max-w-[360px] grid-cols-2 gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!canSend || streaming}
                      onClick={() => void sendMessage(s)}
                      className="rounded-2xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-3 text-center text-[12px] leading-snug text-zinc-700 transition-colors hover:border-[#ff4f12]/30 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-45"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <PreviewChatMessage
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  profileId={chatModel.profile?.id}
                  isStreaming={
                    streaming &&
                    m.role === "assistant" &&
                    i === messages.length - 1
                  }
                  canRegenerate={
                    m.role === "assistant" &&
                    m.id === lastAssistantId &&
                    !streaming &&
                    m.content.trim().length > 0
                  }
                  onRegenerate={
                    m.role === "assistant" && m.id === lastAssistantId
                      ? () => void regenerateAssistant(m.id)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-zinc-200/90 px-3 pb-3 pt-2.5">
          {footerPageText ? (
            <p className="mb-2 text-[11px] leading-snug">
              <span className="font-medium text-zinc-500">
                {isImageAsset ? "Image" : "Document"}
              </span>
              <span className="mx-1.5 text-zinc-300" aria-hidden>
                ·
              </span>
              <span className="font-medium tabular-nums text-zinc-700">{footerPageText}</span>
            </p>
          ) : null}
          {messages.length > 0 && showStatusHint ? (
            <div className="mb-2 px-0.5">{statusHint}</div>
          ) : null}
          <form
            className="overflow-visible rounded-2xl border border-zinc-200 bg-zinc-50/30 focus-within:border-[#ff4f12]/35 focus-within:ring-1 focus-within:ring-[#ff4f12]/10"
            onSubmit={(e) => {
              e.preventDefault()
              void sendMessage(input)
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (canSend && !streaming && input.trim()) void sendMessage(input)
                }
              }}
              rows={3}
              placeholder={streaming ? "Generating…" : "Ask about this file…"}
              disabled={streaming || !canSend}
              className="block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 pb-1 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <ChatModelPicker
                profiles={pickerProfiles}
                selectedProfile={pickerProfile}
                selectedModel={displayModel}
                onChange={handleModelSelect}
                compact
                menuPortal
                lightSurface
                menuGap={14}
                assetModelNeed={need}
                ollamaShow={ollamaShow}
                ollamaShowLoading={ollamaShowLoading}
              />
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleMic}
                  disabled={!supported || streaming}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800",
                    listening && "bg-[#ff4f12]/10 text-[#ff4f12]",
                    !supported && "opacity-35",
                  )}
                  aria-label={listening ? "Stop dictation" : "Dictate message"}
                  title={
                    supported
                      ? listening
                        ? "Stop"
                        : "Dictate"
                      : "Speech not supported in this browser"
                  }
                >
                  {listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
                </button>
                <button
                  type="submit"
                  disabled={!canSend || streaming || !input.trim()}
                  className="flex size-8 items-center justify-center rounded-xl bg-[#ff4f12] text-white transition-opacity hover:bg-[#ff6a33] disabled:opacity-35"
                  aria-label="Send message"
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
      </div>
    </aside>
  )
}
