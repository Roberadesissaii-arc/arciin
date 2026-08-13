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
import {
  expandSlashMessage,
  filterImagePanelSlashCommands,
  getActiveSlashQuery,
  splitTextForSlashHighlight,
  type ChatSlashCommand,
} from "@/components/chat/chat-slash-commands"
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
import {
  buildPageVisionInstruction,
  renderPdfPageToImage,
} from "@/lib/files/render-pdf-page-image"
import { useAssetChatModel } from "@/hooks/use-asset-chat-model"
import { useSpeechToText } from "@/hooks/use-speech-to-text"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuth } from "@/hooks/use-auth"
import { heyTherePhrase, resolveUserGreeting } from "@/lib/user/greeting"
import { parseAssistantHighlights } from "@/lib/files/parse-pdf-highlight-request"
import { inferPdfHighlightTargets } from "@/lib/files/infer-pdf-highlight"
import { inferPdfGotoPage } from "@/lib/files/infer-pdf-page-request"
import { PdfMarkBadges } from "@/components/libraries/pdf-mark-badges"
import type { PdfPageAnnotation } from "@/lib/files/pdf-annotation-layout"
import {
  buildRegenerateNoteInstruction,
  buildStudyPassInstruction,
  isStudyAnnotationRequest,
} from "@/lib/files/pdf-study-request"
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

type PanelMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  /** Marks this turn put on the page, shown as chips under the answer. */
  marks?: PdfHighlightTarget[]
}

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
      // Leads with the annotation feature: it is the thing a student would
      // never guess is there, and the thing the panel is best at.
      page ? "Explain this page to me" : "Summarize this document",
      page ? "Make study notes for this page" : "List the main sections",
      page ? "What should I remember from this page?" : pageLabel,
      page ? "Highlight the section heading on this page" : "Highlight the About This Book heading",
    ]
  }
  if (asset.mediaType === "IMAGE") {
    return [
      "Describe this image",
      "/objects",
      "/highlight the main subject",
      "What text is visible?",
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
  onFocusPdfMark,
  onExportAnnotated,
  exporting,
  renderReport,
  noteCount = 0,
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
  /** Scroll one already-drawn mark into view (badge click). */
  onFocusPdfMark?: (target: PdfHighlightTarget) => void
  /** Handwritten teaching notes the assistant wrote for the page in view. */
  onAnnotatePdf?: (notes: PdfPageAnnotation[]) => void
  /** Text the student selected in the viewer — limits the next study pass. */
  studyScope?: string | null
  /** Swap one note for its rewrite, leaving the rest of the page alone. */
  onReplaceNote?: (id: string, next: PdfPageAnnotation) => void
  /** Filled with a callable so the viewer can ask about a note it was clicked on. */
  rewriteHandleRef?: React.MutableRefObject<
    ((note: PdfPageAnnotation, ask: string) => void) | null
  >
  onExportAnnotated?: () => void
  exporting?: boolean
  /** Correction appended when fewer annotations rendered than were requested. */
  renderReport?: { missedMarks: string[]; missedNotes: number } | null
  notesHidden?: boolean
  onToggleNotes?: () => void
  noteCount?: number
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

  /**
   * The same URL the viewer opened, so rasterising reuses the cached document
   * instead of downloading the file a second time.
   */
  const pdfFileUrl = useMemo(
    () =>
      `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`,
    [asset.id, asset.updatedAt],
  )
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
  const [slashIndex, setSlashIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const speechBaseRef = useRef("")
  /**
   * Section the next study pass is limited to, set by the caller when the
   * student has selected part of the page. Held in a ref so changing it does not
   * re-create the streaming callback mid-turn.
   */
  const studyScopeRef = useRef<string | null>(null)
  /** Id of the note being rewritten this turn, if the student asked about one. */
  const rewriteNoteRef = useRef<string | null>(null)
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

  /**
   * /highlight and /border need vision. Clear a non-vision manual pick so the
   * panel auto-selects a vision-capable model (same path as opening an image).
   */
  const ensureVisionModelForHighlight = useCallback(() => {
    if (!isImageAsset || !profile) return
    setImageModelUserPicked(false)
    const visionModel = resolveModelForProfile({
      provider: profile.provider,
      defaultModel: profile.defaultModel,
      override: null,
      need: "vision",
    })
    if (visionModel) {
      setPickedModel(visionModel)
      setPickedProfileId(profile.id)
      try {
        localStorage.setItem(CHAT_SELECTED_MODEL_KEY, visionModel)
        localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, profile.id)
      } catch {
        /* private mode */
      }
      void setChatSelection({ profileId: profile.id, model: visionModel }).catch(() => {})
    } else {
      // Ollama: let useAssetChatModel re-pick the best vision tag.
      setPickedModel(null)
    }
  }, [isImageAsset, profile])

  const slashActive = useMemo(() => {
    if (!isImageAsset) return null
    return getActiveSlashQuery(input)
  }, [input, isImageAsset])

  const slashMatches = useMemo(() => {
    if (!slashActive) return [] as ChatSlashCommand[]
    return filterImagePanelSlashCommands(slashActive.query)
  }, [slashActive])

  const slashOpen = Boolean(slashActive && slashMatches.length > 0)
  const highlightParts = useMemo(
    () => (isImageAsset ? splitTextForSlashHighlight(input) : [{ text: input, isCommand: false }]),
    [input, isImageAsset],
  )

  useEffect(() => {
    setSlashIndex(0)
  }, [slashActive?.query])

  const applySlashCommand = useCallback(
    (cmd: ChatSlashCommand) => {
      if (!slashActive) return
      const token = `/${cmd.name} `
      const before = input.slice(0, slashActive.replaceStart)
      const afterRaw = input.slice(slashActive.replaceEnd).replace(/^\s*/, "")
      setInput(`${before}${token}${afterRaw}`)
      if (cmd.tools.includes("vision")) {
        ensureVisionModelForHighlight()
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const pos = before.length + token.length
        el.setSelectionRange(pos, pos)
      })
    },
    [ensureVisionModelForHighlight, input, slashActive],
  )

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

      const history: OutboundMsg[] = historyMessages.map((m, i, arr) => {
        let content = m.content
        // Expand /highlight · /border (etc.) so the model always gets the full vision prompt.
        if (m.role === "user" && i === arr.length - 1) {
          const slash = expandSlashMessage(content)
          if (slash) content = slash.text
        }
        return { role: m.role, content }
      })

      let systemContent = assetPreviewChatSystem(asset)
      const lastUserText =
        history.filter((m) => m.role === "user").at(-1)?.content ??
        [...historyMessages].reverse().find((m) => m.role === "user")?.content ??
        ""
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

      /**
       * Restate the output requirement on the user's own turn.
       *
       * The system prompt already documents the tags and the model ignores them
       * there — measured: the same request returned zero tags from the system
       * block and seven from this one. It goes on the payload only, so the
       * bubble the student sees stays the words they typed.
       */
      if (isPdfAsset && pdfPage && pdfPage > 0) {
        for (let i = payload.length - 1; i >= 0; i--) {
          const message = payload[i]!
          if (message.role !== "user") continue
          const typed = typeof message.content === "string" ? message.content : ""
          if (isStudyAnnotationRequest(typed)) {
            payload[i] = {
              ...message,
              content:
                typed +
                buildStudyPassInstruction(typed, { page: pdfPage, scope: studyScopeRef.current }),
            }
          }
          break
        }
      }

      /**
       * Show the model the page it is annotating.
       *
       * Only on a study pass, and only when the model can actually see: an
       * image sent to a text model is wasted tokens, and rasterising costs real
       * time. When it cannot, the turn proceeds on the text layer exactly as
       * before — a page image is an improvement to the assistant's judgement,
       * not a requirement for the feature to work.
       */
      if (isPdfAsset && visionCapable && pdfPage && pdfPage > 0) {
        const lastUser = [...payload].reverse().find((m) => m.role === "user")
        const typed = typeof lastUser?.content === "string" ? lastUser.content : ""
        if (isStudyAnnotationRequest(typed)) {
          const shot = await renderPdfPageToImage(pdfFileUrl, pdfPage)
          if (shot) {
            for (let i = payload.length - 1; i >= 0; i--) {
              if (payload[i].role !== "user") continue
              payload[i] = {
                ...payload[i],
                images: [shot.base64],
                content: payload[i].content + buildPageVisionInstruction(),
              }
              break
            }
          }
        }
      }

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

        // Tags are the fast path; these are the floor under it. A model that
        // says "Highlighted \"Carbon Fixation\"" and emits no tag left the page
        // untouched while telling the user it had marked it.
        const turnUserText =
          [...historyMessages].reverse().find((m) => m.role === "user")?.content ?? ""

        if (onHighlightPdf) {
          const tagged = parseAssistantHighlights(finalText, {
            maxPage: pdfPageCount,
            currentPdfPage: pdfPage,
            pageIndex: pdfPageIndex ?? undefined,
          })
          /**
           * Inference is for a turn that names its own target — "highlight where
           * it says carbon fixation". A planning request does not: "circle the
           * key terms on this page" names a *job*, and feeding it to the phrase
           * extractor searched the page for "key terms on this page" and
           * "explain what each one means", which are instructions, not text. On
           * a planning turn the model's tags are the only legitimate source.
           */
          const planning = isStudyAnnotationRequest(turnUserText)
          const inferred = planning
            ? []
            : inferPdfHighlightTargets({
                userText: turnUserText,
                assistantText: finalText,
                currentPage: pdfPage ?? 0,
                maxPage: pdfPageCount,
              })

          // Union, not either/or. Asked for two targets a model often tags one
          // and describes the other in prose, and taking only the tags drops
          // half the request. Tags come first so their exact quotes win the
          // dedupe; the page search silently discards whatever it cannot find.
          const merged = [...tagged]
          for (const target of inferred) {
            const key = `${target.page}:${target.quote.trim().toLowerCase()}`
            const already = merged.some(
              (t) => `${t.page}:${t.quote.trim().toLowerCase()}` === key,
            )
            if (!already) merged.push(target)
          }

          const sig = merged
            .map((h) => `${h.kind ?? "default"}:${h.page}:${h.quote}`)
            .join("|")
          if (merged.length > 0 && sig !== lastHighlightSigRef.current) {
            lastHighlightSigRef.current = sig
            onHighlightPdf(merged)
            // Kept on the message, not in one shared slot: scrolling back to an
            // earlier answer should still offer that turn's marks.
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, marks: merged } : msg)),
            )
          }
        }
        if (onNavigateToPage && lastGotoRef.current === null) {
          const page = inferPdfGotoPage({
            userText: turnUserText,
            assistantText: finalText,
            maxPage: pdfPageCount,
            pageIndex: pdfPageIndex ?? undefined,
          })
          if (page) {
            lastGotoRef.current = page
            onNavigateToPage(page)
          }
        }

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
      const raw = text.trim()
      if (!raw || streaming) return

      // /highlight · /border auto-switch to a vision model.
      const slash = expandSlashMessage(raw)
      if (slash?.tools.includes("vision")) {
        ensureVisionModelForHighlight()
      }

      // Bubble shows the short slash line; runChatStream expands for the model.
      const modelPreview = slash?.text ?? raw

      lastGotoRef.current = null
      lastHighlightSigRef.current = ""
      lastImageRegionSigRef.current = ""

      if (need === "vision" && userWantsImagePointing(modelPreview)) {
        onClearImageHighlight?.()
      }

      const userMsg: PanelMessage = { id: `u-${Date.now()}`, role: "user", content: raw }
      const assistantId = `a-${Date.now()}`
      const history = [...messages, userMsg]
      setMessages([...history, { id: assistantId, role: "assistant", content: "" }])
      setInput("")
      setStreaming(true)
      await runChatStream(history, assistantId)
    },
    [
      ensureVisionModelForHighlight,
      messages,
      need,
      onClearImageHighlight,
      runChatStream,
      streaming,
    ],
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
                  footer={
                    m.id === lastAssistantId && renderReport &&
                    (renderReport.missedMarks.length > 0 || renderReport.missedNotes > 0) ? (
                      <>
                        {/* The answer describes what the model intended. This
                            describes the page. When they disagree the page
                            wins, and the student is told rather than left to
                            hunt for a mark that was never drawn. */}
                        <p className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
                          {renderReport.missedMarks.length > 0 ? (
                            <>
                              Could not find on this page:{" "}
                              <span className="font-medium">
                                {renderReport.missedMarks.map((q) => `“${q}”`).join(", ")}
                              </span>
                              . {renderReport.missedMarks.length === 1 ? "That mark was" : "Those marks were"}{" "}
                              not drawn.
                            </>
                          ) : null}
                          {renderReport.missedNotes > 0 ? (
                            <>
                              {renderReport.missedMarks.length > 0 ? " " : ""}
                              {renderReport.missedNotes}{" "}
                              {renderReport.missedNotes === 1 ? "note" : "notes"} could not be placed
                              on this page.
                            </>
                          ) : null}
                        </p>
                        {m.marks?.length && onFocusPdfMark ? (
                          <PdfMarkBadges
                            targets={m.marks}
                            currentPage={pdfPage}
                            onFocus={(target) => onFocusPdfMark(target)}
                          />
                        ) : null}
                      </>
                    ) : m.marks?.length && onFocusPdfMark ? (
                      <PdfMarkBadges
                        targets={m.marks}
                        currentPage={pdfPage}
                        onFocus={(target) => onFocusPdfMark(target)}
                      />
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-zinc-200/90 px-3 pb-3 pt-2.5">
          {/* Marks are a layer over the page, never a change to the file, so
              exporting a copy and clearing the layer both belong here. */}
          {onExportAnnotated && noteCount > 0 ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">
                {noteCount} {noteCount === 1 ? "mark" : "marks"} on this document
              </span>
              <button
                type="button"
                onClick={onExportAnnotated}
                disabled={exporting}
                className="ml-auto text-[11px] text-zinc-500 underline-offset-2 transition hover:text-[#ff4f12] hover:underline disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Export PDF"}
              </button>
              <button
                type="button"
                onClick={onClearPdfHighlight}
                className="text-[11px] text-zinc-400 underline-offset-2 transition hover:text-zinc-600 hover:underline"
              >
                Clear
              </button>
            </div>
          ) : null}
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
            className="relative overflow-visible rounded-2xl border border-zinc-200 bg-zinc-50/30 focus-within:border-[#ff4f12]/35 focus-within:ring-1 focus-within:ring-[#ff4f12]/10"
            onSubmit={(e) => {
              e.preventDefault()
              void sendMessage(input)
            }}
          >
            {slashOpen ? (
              <div
                className="absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg ring-1 ring-black/5"
                role="listbox"
                aria-label="Slash commands"
              >
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  Commands
                </p>
                {/* Fixed list — no scrollbar chrome / no up-down chevrons */}
                <div
                  className={cn(
                    "space-y-1 px-2 pb-2",
                    "max-h-[14.5rem] overflow-y-auto",
                    "[scrollbar-width:none] [-ms-overflow-style:none]",
                    "[&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
                  )}
                >
                  {slashMatches.map((cmd, i) => (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={i === slashIndex}
                      className={cn(
                        "flex h-[3.35rem] w-full flex-col justify-center gap-0.5 rounded-xl px-3 py-1.5 text-left transition-colors",
                        i === slashIndex
                          ? "bg-[#ff4f12]/12 text-zinc-900"
                          : "text-zinc-800 hover:bg-zinc-50",
                      )}
                      onMouseEnter={() => setSlashIndex(i)}
                      onClick={() => applySlashCommand(cmd)}
                    >
                      <span className="text-[12px] font-semibold text-[#ff4f12]">/{cmd.name}</span>
                      <span className="line-clamp-1 text-[11px] text-zinc-500">{cmd.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="relative">
              {/* Orange /command highlight (same idea as main chat) */}
              {isImageAsset ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 pb-1 text-[13px] leading-relaxed"
                >
                  {highlightParts.map((part, i) =>
                    part.isCommand ? (
                      <span key={i} className="font-medium text-[#ff4f12]">
                        {part.text}
                      </span>
                    ) : (
                      <span key={i} className="text-zinc-900">
                        {part.text}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (slashOpen) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault()
                      setSlashIndex((i) => Math.min(i + 1, slashMatches.length - 1))
                      return
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault()
                      setSlashIndex((i) => Math.max(i - 1, 0))
                      return
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault()
                      const cmd = slashMatches[slashIndex] ?? slashMatches[0]
                      if (cmd) applySlashCommand(cmd)
                      return
                    }
                    if (e.key === "Escape") {
                      e.preventDefault()
                      setInput((v) => v.replace(/\/[a-zA-Z0-9_-]*$/, ""))
                      return
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    if (canSend && !streaming && input.trim()) void sendMessage(input)
                  }
                }}
                rows={3}
                placeholder={
                  streaming
                    ? "Generating…"
                    : isImageAsset
                      ? "Ask about this image…  Try /objects or /highlight car"
                      : "Ask about this file…"
                }
                disabled={streaming || !canSend}
                className={cn(
                  "block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 pb-1 text-[13px] leading-relaxed outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50",
                  isImageAsset
                    ? "caret-zinc-900 text-transparent"
                    : "text-zinc-900",
                )}
              />
            </div>
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
