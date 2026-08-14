"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { prefetchOllamaAvailableModels } from "@/lib/hooks/use-ollama-available-models"
import { Clock, Plus } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { getOllamaModelShow } from "@/lib/api/models"
import { fetchApi } from "@/lib/api/client"
import {
  autoTitleChatConversation,
  createChatConversation,
  deleteChatConversation,
  getChatConversation,
  getChatConversations,
  getChatInstanceContext,
  getChatSelection,
  getChatStreamPostUrl,
  parseChatHttpError,
  getChatVisionRecent,
  saveChatMessages,
  setChatSelection,
  setChatMessageFeedback,
  updateChatMessage,
  type ChatMessageFeedbackRating,
} from "@/lib/api/chat"
import { getAiSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { DEFAULT_AI_SETTINGS } from "@arciin/shared"
import { cn } from "@/lib/utils"
import { createId } from "@/lib/utils/create-id"
import { type ChatProfilePicker } from "@/components/chat/chat-model-picker"
import {
  CHAT_SELECTED_MODEL_KEY,
  CHAT_SELECTED_PROFILE_ID_KEY,
} from "@/lib/chat/chat-selection-storage"
import { isOllamaProvider, ollamaCapabilitiesIncludeVision } from "@/lib/ollama-providers"
import {
  modelNameLooksVision,
  providerIsMultimodal,
} from "@/lib/chat/asset-chat-model"
import { PROVIDER_MODELS } from "@/lib/chat/provider-models"
import { getAvailableModels } from "@/lib/api/models"
import { useLicense } from "@/lib/license/use-license"

import {
  applyAbortedAssistantMessage,
  formatChatSendError,
  messagePersistId,
  resolveFinalAssistantMessage,
  resolveStreamingBubbleContent,
  displayThinkingDuringStream,
  deriveStreamingThinkingAndAnswer,
  type Message,
  type TokenUsage,
} from "@/components/chat/chat-message-model"
import { finalizeAssistantContent, shouldAttachVisionToUserMessage } from "@/components/chat/chat-intent-helpers"
import { humanizeInstructionFor, shouldHumanizeByDefault } from "@arciin/shared"
import { ARCIIN_DEFAULT_SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION_KEY, buildContextBlock } from "@/components/chat/chat-system-instruction"
import { MessageBubble } from "@/components/chat/chat-message-bubble"
import { WelcomeState } from "@/components/chat/chat-welcome-state"
import { HistorySidebar } from "@/components/chat/chat-history-sidebar"
import { ChatAttachProvider } from "@/components/chat/chat-attach-context"
import { ChatCanvasPanel } from "@/components/chat/chat-canvas-panel"
import {
  buildCanvasFinishedChatSummary,
  deriveCanvasTitle,
  isCanvasWritingIntent,
  refineCanvasTitleFromContent,
  sanitizeCanvasDocument,
  shouldAutoOpenCanvas,
} from "@/components/chat/chat-canvas-helpers"
import { ChatCanvasSaveDialog } from "@/components/chat/chat-canvas-save-dialog"
import { buildCanvasExportFile, type CanvasExportFormat } from "@/lib/chat/canvas-export"
import { loadHandFont } from "@/lib/chat/load-hand-font"
import {
  listCanvasDraftsForConversation,
  rekeyCanvasDraftsForConversation,
  saveCanvasDraft,
} from "@/lib/chat/canvas-draft-store"
import { useUiStore } from "@/lib/stores/ui-store"
import {
  ChatPromptBox,
  type ChatPromptToolId,
} from "@/components/chat/chat-prompt-box"
import {
  type ChatComposerAttachment,
  isAttachableMediaType,
  isImageMediaType,
} from "@/components/chat/chat-composer-attachments"
import { loadAssetImageBase64 } from "@/lib/chat/load-asset-image-base64"
import type { AssetSummary } from "@/lib/types/models"
import {
  buildPromptToolsSystemAppend,
  promptToolsForceCanvas,
  promptToolsForceThinking,
  promptToolsForceVision,
} from "@/components/chat/chat-prompt-tools"
import { expandSlashMessage } from "@/components/chat/chat-slash-commands"
import { getLibraries } from "@/lib/api/libraries"
import { uploadFile } from "@/lib/api/uploads"

type ChatProfile = ChatProfilePicker

export function ChatPage() {
  const queryClient = useQueryClient()
  const license = useLicense()
  // Two different questions, and conflating them caused a paying customer to be
  // shown an upgrade prompt on every load.
  //
  // `hasFeature` is false while the entitlement answer is still in flight, so
  // using it for the UI rendered the paywall during that window and then
  // replaced it — the flash the EntitlementState machine exists to prevent.
  // `shouldPaywall` is true only once the answer is authoritative.
  //
  // Sending stays blocked on the conservative check: not knowing yet is a
  // reason to hold a request, but not a reason to tell someone to upgrade.
  //
  // `shouldPaywall` alone was not enough: a cached Pro snapshot keeps the plan
  // inside its grace window, so an authoritative Free answer produced no gate
  // at all. Falling back to "the answer is ready and the feature is absent"
  // restores gating without reintroducing the flash, because `ready` is false
  // for the whole time the answer is in flight.
  const chatPaywalled =
    license.shouldPaywall("ai.chat") || (license.ready && !license.hasFeature("ai.chat"))
  const chatLocked = !license.hasFeature("ai.chat")
  const chatPlanLabel = license.planLabel(license.requiredPlanFor("ai.chat") ?? "pro")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<ChatProfile | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const historyOpen = useUiStore((s) => s.chatHistoryOpen)
  const setHistoryOpen = useUiStore((s) => s.setChatHistoryOpen)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [promptTools, setPromptTools] = useState<ChatPromptToolId[]>([])
  const [attachments, setAttachments] = useState<ChatComposerAttachment[]>([])
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasContent, setCanvasContent] = useState("")
  const [canvasTitle, setCanvasTitle] = useState("Canvas")
  const [canvasStreaming, setCanvasStreaming] = useState(false)
  const [canvasSaving, setCanvasSaving] = useState(false)
  const [canvasHandwriting, setCanvasHandwriting] = useState(false)
  const [canvasSaveOpen, setCanvasSaveOpen] = useState(false)
  const [canvasSaveFormat, setCanvasSaveFormat] = useState<CanvasExportFormat>("pdf")
  /** Message id of the draft currently shown in the Canvas panel (for re-save/re-link). */
  const [activeCanvasMessageId, setActiveCanvasMessageId] = useState<string | null>(null)
  const [attachBusyId, setAttachBusyId] = useState<string | null>(null)
  const thinkChipSynced = useRef(false)
  const aiSettingsQuery = useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: ({ signal }) => getAiSettings(signal),
    staleTime: 30_000,
  })
  const showThinking = aiSettingsQuery.data?.showThinking ?? DEFAULT_AI_SETTINGS.showThinking

  // Seed Think chip from Settings once so users who enabled “Show thinking” start with it on.
  // Turning the chip off hides the reasoning panel for that turn (chip is the real control).
  useEffect(() => {
    if (thinkChipSynced.current || aiSettingsQuery.isLoading) return
    thinkChipSynced.current = true
    if (showThinking) {
      setPromptTools((prev) =>
        prev.includes("thinking") ? prev : [...prev, "thinking"],
      )
    }
  }, [showThinking, aiSettingsQuery.isLoading])

  const systemInstruction = typeof window !== "undefined"
    ? (localStorage.getItem(SYSTEM_INSTRUCTION_KEY) ?? ARCIIN_DEFAULT_SYSTEM_INSTRUCTION)
    : ARCIIN_DEFAULT_SYSTEM_INSTRUCTION

  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const messagesInnerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

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

  /**
   * When Vision is toggled on, switch the model picker to a vision-capable model.
   * Does not attach any image — user adds their own via “Add image”.
   */
  const ensureVisionModel = useCallback(async () => {
    const current =
      selectedModel || selectedProfile?.defaultModel || ""
    if (
      current &&
      (modelNameLooksVision(current) ||
        (selectedProfile && providerIsMultimodal(selectedProfile.provider, current)))
    ) {
      return
    }

    const list = profiles.length > 0 ? profiles : []
    // Prefer current profile’s vision tag, then any profile.
    const order = selectedProfile
      ? [selectedProfile, ...list.filter((p) => p.id !== selectedProfile.id)]
      : list

    for (const profile of order) {
      if (isOllamaProvider(profile.provider)) {
        try {
          const data = await queryClient.fetchQuery({
            queryKey: queryKeys.availableModels(profile.id),
            queryFn: ({ signal }) => getAvailableModels(profile.id, { signal }),
            staleTime: 60_000,
          })
          const models = data?.models ?? []
          const visionTag =
            models.find((m) => modelNameLooksVision(m)) ??
            (profile.defaultModel && modelNameLooksVision(profile.defaultModel)
              ? profile.defaultModel
              : null)
          if (visionTag) {
            setSelectedProfile(profile)
            setSelectedModel(visionTag)
            try {
              localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, profile.id)
              localStorage.setItem(CHAT_SELECTED_MODEL_KEY, visionTag)
            } catch {
              /* private mode */
            }
            void setChatSelection({ profileId: profile.id, model: visionTag }).catch(() => {})
            toast.info("Switched to a vision model", {
              description: visionTag,
            })
            return
          }
        } catch {
          /* try next profile */
        }
      } else {
        const catalogue = PROVIDER_MODELS[profile.provider] ?? []
        const visionTag =
          catalogue.find((m) => providerIsMultimodal(profile.provider, m) || modelNameLooksVision(m)) ??
          (profile.defaultModel &&
          (providerIsMultimodal(profile.provider, profile.defaultModel) ||
            modelNameLooksVision(profile.defaultModel))
            ? profile.defaultModel
            : null)
        if (visionTag) {
          setSelectedProfile(profile)
          setSelectedModel(visionTag)
          try {
            localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, profile.id)
            localStorage.setItem(CHAT_SELECTED_MODEL_KEY, visionTag)
          } catch {
            /* private mode */
          }
          void setChatSelection({ profileId: profile.id, model: visionTag }).catch(() => {})
          toast.info("Switched to a vision model", {
            description: visionTag,
          })
          return
        }
      }
    }

    toast.warning("No vision model found", {
      description: "Connect a vision-capable model under Models (eye icon).",
    })
  }, [profiles, queryClient, selectedModel, selectedProfile])

  const handlePromptToolsChange = useCallback(
    (next: ChatPromptToolId[]) => {
      const wasVision = promptTools.includes("vision")
      const nowVision = next.includes("vision")
      const wasCanvas = promptTools.includes("canvas")
      const nowCanvas = next.includes("canvas")
      setPromptTools(next)
      if (nowVision && !wasVision) {
        // Keep only image attachments when entering Vision mode.
        setAttachments((prev) => prev.filter((a) => isImageMediaType(a.mediaType)))
        void ensureVisionModel()
      }
      // Canvas chip toggles the side panel open and closed.
      if (nowCanvas && !wasCanvas) {
        setCanvasOpen(true)
      } else if (!nowCanvas && wasCanvas) {
        setCanvasOpen(false)
      }
    },
    [promptTools, ensureVisionModel],
  )

  /** Click a listed PDF/image/file in chat → attach to composer for follow-ups. */
  const attachAssetFromList = useCallback(
    async (asset: AssetSummary) => {
      if (chatLocked || streaming) {
        toast.warning(chatLocked ? "Chat is locked" : "Wait for the current reply to finish")
        return
      }
      if (!isAttachableMediaType(asset.mediaType)) {
        toast.warning("Can't attach this file type", {
          description: "Try a document, image, or similar library file.",
        })
        return
      }
      if (attachments.some((a) => a.assetId === asset.id)) {
        toast.message("Already attached", {
          description: asset.originalFilename,
        })
        return
      }
      if (attachments.length >= 4) {
        toast.warning("Attachment limit", {
          description: "Remove one attachment first (max 4).",
        })
        return
      }

      setAttachBusyId(asset.id)
      try {
        let imageBase64: string | undefined
        if (isImageMediaType(asset.mediaType)) {
          const b64 = await loadAssetImageBase64(asset.id, asset.updatedAt)
          if (b64) imageBase64 = b64
        }
        const next: ChatComposerAttachment = {
          assetId: asset.id,
          filename: asset.originalFilename,
          mediaType: asset.mediaType,
          updatedAt: asset.updatedAt,
          imageBase64,
        }
        setAttachments((prev) => [...prev, next].slice(0, 4))

        if (isImageMediaType(asset.mediaType)) {
          setPromptTools((prev) => {
            const withoutFiles = prev.filter((t) => t !== "files")
            return withoutFiles.includes("vision") ? withoutFiles : [...withoutFiles, "vision"]
          })
          void ensureVisionModel()
          toast.success("Image attached", {
            description: "Vision is on — ask a follow-up about this image.",
          })
        } else {
          setPromptTools((prev) => (prev.includes("files") ? prev : [...prev, "files"]))
          toast.success("File attached", {
            description: "Ask a follow-up or type /summarize and send.",
          })
        }
      } catch (err) {
        toast.error("Could not attach file", {
          description: err instanceof Error ? err.message : "Try again",
        })
      } finally {
        setAttachBusyId(null)
      }
    },
    [attachments, chatLocked, streaming, ensureVisionModel],
  )

  const chatAttachValue = useMemo(
    () => ({
      attachedIds: new Set(attachments.map((a) => a.assetId)),
      busyAssetId: attachBusyId,
      attachAsset: attachAssetFromList,
    }),
    [attachments, attachBusyId, attachAssetFromList],
  )

  useEffect(() => {
    for (const profile of profiles) {
      if (isOllamaProvider(profile.provider)) {
        void prefetchOllamaAvailableModels(queryClient, profile.id)
      }
    }
  }, [profiles, queryClient])

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
    onError: (e: Error) =>
      toast.error("Could not delete conversation", {
        description: e.message || "Try again in a moment.",
      }),
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

    void getChatSelection()
      .then((remote) => {
        if (!remote?.profileId) return
        const remoteProfile = profiles.find((p) => p.id === remote.profileId)
        if (!remoteProfile) return
        setSelectedProfile(remoteProfile)
        setSelectedModel(remote.model || remoteProfile.defaultModel || "")
        try {
          localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, remoteProfile.id)
          localStorage.setItem(CHAT_SELECTED_MODEL_KEY, remote.model)
        } catch {
          /* private mode */
        }
      })
      .catch(() => {
        /* use local fallback above */
      })
  }, [profiles, selectedProfile])

  // ── Scroll ─────────────────────────────────────────────────────────────────

  /**
   * Set while we are scrolling the list ourselves.
   *
   * Our own `scrollTo` fires a `scroll` event exactly like a user gesture, and
   * that event lands with the container already at the bottom — so the handler
   * re-pinned immediately after the reader had scrolled away. During streaming
   * that happens on every token, which is why scrolling up felt stuck: the
   * unpin was real, and then instantly undone.
   */
  const programmaticScrollRef = useRef(false)

  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = messagesScrollRef.current
    if (!el || !stickToBottomRef.current) return
    programmaticScrollRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" })
  }, [])

  useLayoutEffect(() => {
    scrollToBottom(streaming)
  }, [messages, streaming, scrollToBottom])

  useEffect(() => {
    const outer = messagesScrollRef.current
    const inner = messagesInnerRef.current
    if (!outer || !inner) return

    const bump = () => {
      if (!stickToBottomRef.current) return
      programmaticScrollRef.current = true
      outer.scrollTo({ top: outer.scrollHeight, behavior: "auto" })
    }

    const ro = new ResizeObserver(bump)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [messages.length])

  function handleMessagesScroll() {
    const el = messagesScrollRef.current
    if (!el) return

    // Ignore the echo of our own scroll; only a real gesture changes the pin.
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false
      return
    }

    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = dist < 100
  }

  /**
   * Unpin the moment the reader gestures upward.
   *
   * The distance check alone is not enough while content is streaming in: the
   * container grows under the reader, so a deliberate scroll up can still
   * measure as "near the bottom" and be treated as following along.
   */
  function handleMessagesWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0) stickToBottomRef.current = false
  }

  function handleMessagesTouchMove() {
    const el = messagesScrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    if (dist >= 100) stickToBottomRef.current = false
  }

  // ── Load conversation ──────────────────────────────────────────────────────

  const [loadingConvoId, setLoadingConvoId] = useState<string | null>(null)

  async function loadConversation(id: string) {
    if (id === conversationId) {
      setHistoryOpen(false)
      setMobileHistoryOpen(false)
      return
    }
    setLoadingConvoId(id)
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.chatConversation(id),
        queryFn:  ({ signal }) => getChatConversation(id, signal),
        staleTime: 30_000,
      })
      stickToBottomRef.current = true
      setConversationId(id)
      const drafts = listCanvasDraftsForConversation(id)
      const draftByMsg = new Map(drafts.map((d) => [d.messageId, d]))
      setMessages(
        detail.messages
          .filter((m) => m.role !== "system")
          .map((m) => {
            const draft = draftByMsg.get(m.id)
            return {
              id: m.id,
              dbId: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              feedback: m.feedbackRating ?? null,
              usage: m.totalTokens
                ? {
                    inputTokens: m.inputTokens ?? 0,
                    outputTokens: m.outputTokens ?? 0,
                    totalTokens: m.totalTokens,
                  }
                : undefined,
              ...(draft
                ? {
                    canvasDraft: {
                      id: draft.messageId,
                      title: draft.title,
                      content: draft.content,
                    },
                  }
                : {}),
            }
          }),
      )
      // Restore latest canvas draft for this conversation into the panel (closed until user opens).
      const latestDraft = drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (latestDraft) {
        setCanvasTitle(latestDraft.title)
        setCanvasContent(latestDraft.content)
        setActiveCanvasMessageId(latestDraft.messageId)
        setCanvasOpen(false)
      } else {
        setCanvasContent("")
        setCanvasTitle("Canvas")
        setActiveCanvasMessageId(null)
        setCanvasOpen(false)
      }
      setHistoryOpen(false)
      setMobileHistoryOpen(false)
    } catch {
      toast.error("Could not load conversation", { description: "Try again in a moment." })
    } finally {
      setLoadingConvoId(null)
    }
  }

  function startNewChat() {
    setConversationId(null)
    setMessages([])
    setInput("")
    setCanvasContent("")
    setCanvasTitle("Canvas")
    setActiveCanvasMessageId(null)
    setCanvasOpen(false)
    setCanvasStreaming(false)
  }

  const openCanvasDraft = useCallback(
    (draft: NonNullable<Message["canvasDraft"]>) => {
      setCanvasTitle(draft.title)
      setCanvasContent(draft.content)
      setActiveCanvasMessageId(draft.id)
      setCanvasOpen(true)
      setCanvasStreaming(false)
      // Ensure Canvas chip reflects open panel.
      setPromptTools((prev) => (prev.includes("canvas") ? prev : [...prev, "canvas"]))
    },
    [],
  )

  async function handleMessageFeedback(msg: Message, rating: ChatMessageFeedbackRating | null) {
    const persistId = messagePersistId(msg)
    if (msg.pending) return
    if (!persistId) {
      toast.info("Still saving this reply", {
        description: "Try rating it again in a moment.",
      })
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
      toast.error("Could not save feedback", { description: "Try again in a moment." })
    }
  }

  function applyPersistedMessageIds(
    prev: Message[],
    saved: { id: string; role: string }[],
    pendingAssistantId: string,
    pendingUserId?: string,
    convoId?: string | null,
  ) {
    const userRow = saved.find((m) => m.role === "user")
    const asstRow = saved.find((m) => m.role === "assistant")
    const map: Array<{ fromId: string; toId: string }> = []
    if (pendingUserId && userRow) map.push({ fromId: pendingUserId, toId: userRow.id })
    if (asstRow) map.push({ fromId: pendingAssistantId, toId: asstRow.id })
    if (map.length && convoId) {
      rekeyCanvasDraftsForConversation(null, convoId, map)
      rekeyCanvasDraftsForConversation(conversationId, convoId, map)
    }
    return prev.map((m) => {
      if (pendingUserId && m.id === pendingUserId && userRow) {
        return { ...m, id: userRow.id, dbId: userRow.id }
      }
      if (m.id === pendingAssistantId && asstRow) {
        const draft = m.canvasDraft
          ? { ...m.canvasDraft, id: asstRow.id }
          : undefined
        if (draft && convoId) {
          saveCanvasDraft({
            id: asstRow.id,
            conversationId: convoId,
            messageId: asstRow.id,
            title: draft.title,
            content: draft.content,
            updatedAt: new Date().toISOString(),
          })
        }
        if (activeCanvasMessageId === pendingAssistantId) {
          setActiveCanvasMessageId(asstRow.id)
        }
        return { ...m, id: asstRow.id, dbId: asstRow.id, canvasDraft: draft }
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
      id: createId(),
      role: "assistant",
      content: "",
      pending: true,
      ...(reasoningUiEnabled ? { thinking: "" } : {}),
    }

    stickToBottomRef.current = true
    setMessages([...priorMessages, pendingMsg])
    setStreaming(true)
    setStreamingMsgId(pendingMsg.id)

    const profile = selectedProfile ?? profiles[0]
    if (!profile) {
      toast.error("No model selected", { description: "Connect one under Models first." })
      setStreaming(false)
      setStreamingMsgId(null)
      return
    }

    type OutboundMsg = { role: "user" | "assistant" | "system"; content: string; images?: string[] }
    const history: OutboundMsg[] = priorMessages.map((m) => ({ role: m.role, content: m.content }))
    const sysPrompt = systemInstruction.trim()
    const instanceBlock = contextQuery.data ? "\n\n" + buildContextBlock(contextQuery.data) : ""
    // Long-form drafting gets the humanised-writing guidance without being
    // asked. The habits it corrects — even sentence rhythm, stock transitions,
    // vague nouns — are what make a draft read as machine-written, and they are
    // cheapest to avoid while writing rather than to edit out afterwards.
    const humanizeBlock = shouldHumanizeByDefault({ userText })
      ? "\n\n" + humanizeInstructionFor("default")
      : ""
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

    let sysTail = instanceBlock + humanizeBlock
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
        body: JSON.stringify({
          profileId: profile.id,
          ...(modelToSend ? { model: modelToSend } : {}),
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
      let thinkingAccum = ""
      let streamStatus = ""
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
              error?: string
              text?: string
              thinking?: string
              status?: string
              usage?: TokenUsage
              libraryAction?: string
            }
            if (json.error) throw new Error(json.error)
            if (json.libraryAction) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
              void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
              void queryClient.invalidateQueries({ queryKey: ["folders"] })
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatContext })
            }
            if (json.status) streamStatus = json.status
            if (json.thinking) thinkingAccum += json.thinking
            if (json.text) {
              accumulated += json.text
              // Keep last tool status until real answer prose arrives (resolved below).
            }
            if (json.usage) finalUsage = json.usage
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") throw parseErr
          }
        }
        const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showThinking)
        const displayThinking = displayThinkingDuringStream(reasoningUiEnabled, derived)
        const displayContent = finalizeAssistantContent(derived.answer, userText, priorMessages, {
          streaming: true,
        })
        const bubble = resolveStreamingBubbleContent({
          displayContent,
          streamStatus,
          forceCanvas: false,
        })
        flushSync(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingMsg.id
                ? {
                    ...m,
                    content: bubble.content,
                    thinking: displayThinking,
                    streamStatus: bubble.streamStatus,
                    pending: false,
                    usage: finalUsage ?? m.usage,
                  }
                : m,
            ),
          )
        })
        if (streamDone || done) break
      }

      const resolved = resolveFinalAssistantMessage(accumulated, thinkingAccum, showThinking, reasoningUiEnabled)
      finalContent = finalizeAssistantContent(resolved.content, userText, priorMessages)
      const finalThinking = resolved.thinking
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                content: finalContent,
                thinking: finalThinking,
                streamStatus: undefined,
                pending: false,
                usage: finalUsage ?? m.usage,
              }
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
        setMessages((prev) => applyAbortedAssistantMessage(prev, pendingMsg.id))
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, content: formatChatSendError(err), pending: false }
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

  async function sendMessage(overrideText?: string) {
    if (chatLocked) {
      toast.error(`${chatPlanLabel} required`, {
        description: `Activate ${chatPlanLabel} to send messages.`,
      })
      return
    }
    let text = (overrideText ?? input).trim()
    if (streaming) return
    if (!text && attachments.length === 0) return

    const profile = selectedProfile ?? profiles[0]
    if (!profile) {
      toast.error("No model selected", { description: "Connect one under Models first." })
      return
    }

    // Slash commands (/summarize …) expand to full prompts + tool chips.
    let activeTools: ChatPromptToolId[] = overrideText ? [] : [...promptTools]
    if (!overrideText && text) {
      /**
       * Handled here and nowhere else: /font is a change of typeface, so it
       * takes effect at once instead of costing a round trip to a model that
       * might rewrite the prose while it was there.
       *
       * `on` and `off` are accepted explicitly because a bare toggle is
       * invisible when the Canvas is empty: switching it on with no draft
       * showing looks like nothing happened, and then the next draft arrives in
       * handwriting nobody asked for — which reads as the command doing the
       * opposite of what it says. The state is always announced.
       */
      const fontCommand = text.match(/^\s*\/font\b[.\s]*(on|off)?\b/i)
      if (fontCommand) {
        const asked = fontCommand[1]?.toLowerCase()
        const next = asked === "on" ? true : asked === "off" ? false : !canvasHandwriting
        setCanvasHandwriting(next)
        setCanvasOpen(true)
        setInput("")
        toast.success(next ? "Canvas is in handwriting" : "Canvas is back to the reading face", {
          description: next
            ? "Saved and copied drafts keep their normal text."
            : "Type /font to switch back.",
        })
        return
      }

      const slash = expandSlashMessage(text)
      if (slash) {
        text = slash.text
        activeTools = Array.from(new Set([...activeTools, ...slash.tools]))
        setPromptTools(activeTools)
      }
    }

    const forceVision = promptToolsForceVision(activeTools)
    const forceThinking = promptToolsForceThinking(activeTools)
    // Think chip gates the reasoning panel — off means answer-only for this turn.
    const turnReasoningUi = forceThinking
    const canvasChipOn = promptToolsForceCanvas(activeTools)

    const imageAttachments = attachments.filter(
      (a) => isImageMediaType(a.mediaType) && a.imageBase64,
    )
    const docAttachments = attachments.filter((a) => !isImageMediaType(a.mediaType))

    // Vision chip requires a user-chosen image before send (no auto library attach).
    if (forceVision && imageAttachments.length === 0) {
      toast.warning("Attach an image first", {
        description: "Vision is on — use the paperclip to pick an image from your library.",
      })
      return
    }

    // Empty text + attachments only: invent a minimal prompt for the model.
    if (!text) {
      if (imageAttachments.length > 0) {
        text = "Describe the attached image(s) in detail."
      } else if (docAttachments.length > 0) {
        text = `Read and explain the attached file(s): ${docAttachments.map((d) => d.filename).join(", ")}.`
      }
    }

    // Canvas routing reads this, not the augmented text below: the attachment
    // block literally contains the words "essay, summary, exam", so matching
    // against `text` after augmentation says "canvas" for every attached file.
    const typedText = text

    // Document attachments MUST be part of the outbound user text BEFORE history/payload
    // is built — otherwise the model never sees which book was selected.
    // The API auto-loads PDF/text for attached ids; do NOT tell the model to "call tools"
    // (that makes it narrate tool plans instead of writing the essay).
    if (docAttachments.length > 0) {
      const names = docAttachments
        .map((d) => `"${d.filename}" (id=${d.assetId})`)
        .join(", ")
      const primary = docAttachments[0]!
      text =
        `${text}\n\n` +
        `[USER ATTACHED FILE(S) — REQUIRED CONTEXT]\n` +
        `The user selected these library file(s) for this message: ${names}.\n` +
        `When they say "this book", "this document", "this PDF", or "it", they mean these attached file(s) — ` +
        `especially "${primary.filename}" (id=${primary.assetId}).\n` +
        `Arciin will load the file text automatically for this turn. ` +
        `Write the full answer (essay, summary, exam, etc.) from that source. ` +
        `Do NOT ask which book — it is already attached. Do NOT list the whole library. ` +
        `Do NOT print tool_call XML, JSON, or lines like "I need to read the PDF". ` +
        `Start the deliverable immediately.`
      if (!activeTools.includes("files")) {
        activeTools = [...activeTools, "files"]
      }
    }

    // Canvas chip opens the panel; only long-form writing routes into it.
    // "List my books" stays in chat even when Canvas is open.
    // With an attached book + essay/exam/quiz request, force canvas when chip is on.
    // `/modify` edits the draft that already exists, so it routes to Canvas
    // regardless of the chip and regardless of whether the words read as a
    // "writing request" — "cut the third section" does not, but it is still
    // canvas work.
    const isCanvasEdit = /^\s*\/modify\b/i.test((overrideText ?? input).trim())

    // The chip is a hint, not the only way in. Asking for a document — or
    // naming the canvas outright — routes there whether or not it is toggled,
    // because remembering to arm a toggle before every note is not the user's
    // job.
    const autoCanvas = shouldAutoOpenCanvas(typedText)

    const forceCanvas =
      isCanvasEdit ||
      autoCanvas ||
      (canvasChipOn &&
      (isCanvasWritingIntent(typedText) ||
        (docAttachments.length > 0 &&
          /\b(essay|article|draft|write|report|story|exam|quiz|test|questions?|worksheet|homework|study\s+guide|documentation|docs?|manual|outline)\b/i.test(
            typedText,
          ))))

    // Open the panel for this turn without arming the chip. Latching it on was
    // wrong: the chip switches routing to a deliberately looser test, so one
    // auto-routed document turned every following message into a candidate for
    // Canvas — the user asks a question five turns later and gets a document.
    // Each turn is now classified on its own words.
    if (forceCanvas && !canvasChipOn) {
      setCanvasOpen(true)
    }

    // The draft itself has to travel with the request. Without it the model has
    // no document to revise and writes a new one — which is the exact
    // behaviour /modify exists to prevent.
    const canvasEditBody =
      isCanvasEdit && canvasContent.trim()
        ? `\n\nCURRENT CANVAS DRAFT (revise this exact text):\n\n${canvasContent.trim()}`
        : ""

    // Display bubble: keep the human-typed slash line if we expanded.
    // Snapshot tray attachments so the bubble shows what was sent.
    const displayUserText = (overrideText ?? input).trim() || text
    const attachedForBubble = imageAttachments
      .map((a) => a.imageBase64!)
      .slice(0, 3)
    const fileAttachmentsForBubble = docAttachments.map((d) => ({
      assetId: d.assetId,
      filename: d.filename,
      mediaType: d.mediaType,
      updatedAt: d.updatedAt,
    }))
    const userMsg: Message = {
      id: createId(),
      role: "user",
      content: displayUserText,
      ...(attachedForBubble.length > 0 ? { images: attachedForBubble } : {}),
      ...(fileAttachmentsForBubble.length > 0
        ? { fileAttachments: fileAttachmentsForBubble }
        : {}),
    }
    const pendingMsg: Message = {
      id: createId(),
      role: "assistant",
      content: forceCanvas ? "Writing in Canvas…" : "",
      pending: true,
      ...(turnReasoningUi ? { thinking: "" } : {}),
    }

    stickToBottomRef.current = true
    setMessages((prev) => [...prev, userMsg, pendingMsg])
    setInput("")
    setStreaming(true)

    // Held in a local, not read back off state at the end of the turn. `canvasTitle`
    // in this function is the value from the render that started the send, so the
    // setter below does not change what the finaliser sees — a turn whose document
    // had no heading kept the *previous* turn's title, which is how a request for
    // upload documentation came back titled "Photosynthesis Quiz — 10 Questions".
    let turnCanvasTitle = canvasTitle
    if (forceCanvas) {
      setCanvasOpen(true)
      setCanvasStreaming(true)
      const bookTitle =
        docAttachments[0]?.filename.replace(/\.pdf$/i, "").trim() ||
        deriveCanvasTitle(displayUserText)
      turnCanvasTitle = /\bessay\b/i.test(displayUserText)
        ? `Essay: ${bookTitle}`.slice(0, 80)
        : bookTitle.slice(0, 80)
      setCanvasTitle(turnCanvasTitle)
      setCanvasContent("")
    }

    type OutboundMsg = {
      role: "user" | "assistant" | "system"
      content: string
      images?: string[]
    }

    // Send expanded slash text + attachment context; bubble keeps what the user typed.
    const history: OutboundMsg[] = [
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: text + canvasEditBody },
    ]
    const sysPrompt = systemInstruction.trim()

    const instanceBlock = contextQuery.data ? "\n\n" + buildContextBlock(contextQuery.data) : ""
    // Canvas is always long-form, so it always gets the guidance. /humanize
    // sends the fuller brief in the message itself and does not need it twice.
    const humanizeBlock =
      !/\bHumanize\b/i.test(text) && shouldHumanizeByDefault({ canvas: forceCanvas, userText: text })
        ? "\n\n" + humanizeInstructionFor("default")
        : ""
    const caps = ollamaShowQuery.data?.capabilities
    const modelToSend = selectedModel || profile.defaultModel || undefined
    const visionCapable =
      Boolean(modelToSend && modelNameLooksVision(modelToSend)) ||
      Boolean(profile && modelToSend && providerIsMultimodal(profile.provider, modelToSend)) ||
      (ollamaChat &&
        (ollamaCapabilitiesIncludeVision(caps) === true ||
          /qwen3\.5|llava|gemma.*vision|minicpm-v|moondream|bakllava|ministral/i.test(
            activeModelLabel,
          )))

    // Vision chip: only user-added tray images (never auto-pick from the library).
    // Always attach tray bytes when present — do not drop them if capability heuristic is lagging.
    let visionImages: string[] | undefined

    if (forceVision && !visionCapable) {
      toast.warning("Vision needs a vision model", {
        description: "Pick a model with the eye icon (Vision chip auto-switches when possible).",
      })
    }

    if (forceVision || imageAttachments.length > 0) {
      // User-chosen library/upload attachments only — always send pixels when present.
      visionImages = imageAttachments.map((a) => a.imageBase64!).slice(0, 3)
    } else if (visionCapable && shouldAttachVisionToUserMessage(text, messages)) {
      try {
        const limit: 1 | 2 | 3 = /\b(compare|both|all three|each of)\b/i.test(text) ? 2 : 1
        const vision = await getChatVisionRecent(limit)
        if (vision.images.length > 0) {
          visionImages = vision.images
        } else {
          toast.warning("No readable image found", {
            description: "The file is missing or over 4 MB. Try a different image in your library.",
          })
        }
      } catch {
        toast.error("Could not load your image", {
          description: "Check that the file still exists in Images.",
        })
      }
    }

    // Keep tray attachments for follow-ups until the user removes them.
    // If images came from auto library attach (no tray), still show them on the bubble.
    if (visionImages?.length) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMsg.id
            ? { ...m, images: m.images?.length ? m.images : visionImages }
            : m,
        ),
      )
    }

    // Only inject Canvas long-form system rules when this turn is actually writing.
    const toolsForSys = forceCanvas
      ? (activeTools.includes("canvas")
          ? activeTools
          : ([...activeTools, "canvas"] as ChatPromptToolId[]))
      : activeTools.filter((t) => t !== "canvas")
    let sysTail = instanceBlock + humanizeBlock + buildPromptToolsSystemAppend(toolsForSys)
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
        body: JSON.stringify({
          profileId: profile.id,
          ...(modelToSend ? { model: modelToSend } : {}),
          // Tells the API this turn produces a document, so it withholds the
          // tools that would otherwise write it somewhere instead.
          ...(forceCanvas ? { canvas: true } : {}),
          messages: payload,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error(await parseChatHttpError(res))
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let accumulated  = ""  // text/content chunks (may contain <think> tags in some models)
      let thinkingAccum = "" // dedicated thinking chunks (Ollama native / compat)
      let streamStatus = ""
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
              status?: string
              usage?: TokenUsage
              libraryAction?: string
            }
            if (json.error) throw new Error(json.error)

            if (json.libraryAction) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
              void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
              void queryClient.invalidateQueries({ queryKey: ["folders"] })
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatContext })
            }

            if (json.status) streamStatus = json.status
            if (json.thinking) thinkingAccum += json.thinking
            if (json.text) {
              accumulated += json.text
              // Keep last tool status until real answer prose arrives (resolved below).
            }
            if (json.usage) finalUsage = json.usage
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
              throw parseErr
            }
          }
        }

        // Think chip gates reasoning UI for this turn (off = answer only).
        const showReasoningPanel = forceThinking
        const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showReasoningPanel)
        const displayThinking = displayThinkingDuringStream(turnReasoningUi, derived)
        const displayContent = finalizeAssistantContent(derived.answer, text, messages, {
          streaming: true,
        })
        const bubble = resolveStreamingBubbleContent({
          displayContent,
          streamStatus,
          forceCanvas,
        })

        if (forceCanvas) {
          // Canvas gets document body only — never "Okay let me write…" preambles.
          setCanvasContent(sanitizeCanvasDocument(displayContent))
          setCanvasStreaming(true)
        }

        flushSync(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingMsg.id
                ? {
                    ...m,
                    // Canvas / placeholder: never surface [[ASSETS]] or tool talk in chat.
                    content: bubble.content,
                    thinking: displayThinking,
                    streamStatus: bubble.streamStatus,
                    pending: false,
                    usage: finalUsage ?? m.usage,
                  }
                : m,
            ),
          )
        })

        if (streamDone || done) break
      }

      const resolved = resolveFinalAssistantMessage(
        accumulated,
        thinkingAccum,
        forceThinking,
        turnReasoningUi,
      )
      finalContent = finalizeAssistantContent(resolved.content, text, messages)
      const finalThinking = resolved.thinking
      let canvasChatSummary = ""
      let canvasDraftForMsg: Message["canvasDraft"] | undefined
      if (forceCanvas) {
        const docOnly = sanitizeCanvasDocument(finalContent)
        const nextTitle = refineCanvasTitleFromContent(docOnly, turnCanvasTitle)
        setCanvasContent(docOnly)
        setCanvasStreaming(false)
        setCanvasOpen(true)
        setCanvasTitle(nextTitle)
        setActiveCanvasMessageId(pendingMsg.id)
        const wordCount = docOnly
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/[#>*_`\[\]()]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .split(" ")
          .filter(Boolean).length
        const looksLikeProcessTalk =
          wordCount > 0 &&
          wordCount < 120 &&
          /\b(need to read|read_pdf_asset|attempting to read|tool_call|i will (?:read|open)|let me (?:read|open))\b/i.test(
            docOnly,
          )
        if (!docOnly.trim()) {
          canvasChatSummary =
            "Canvas finished, but no essay text was produced. Attach the book and try again — Arciin will load the PDF automatically."
        } else {
          canvasChatSummary = buildCanvasFinishedChatSummary({
            title: nextTitle,
            content: docOnly,
            userText: displayUserText,
            attachedFilenames: docAttachments.map((d) => d.filename),
          })
          // A canvas turn that produced a stub is a failure wearing a success
          // message: "Generate documentation for how uploads work" came back as
          // 54 words and still announced itself as a finished document.
          if (looksLikeProcessTalk || wordCount < 150) {
            canvasChatSummary +=
              docAttachments.length > 0
                ? `\n\n⚠️ This draft is only ~${wordCount} words. If it is incomplete, re-send the request — the server loads the PDF automatically.`
                : `\n\n⚠️ This draft is only ~${wordCount} words, which is short for a document. Re-send the request, or ask for more detail on a specific section.`
          }
        }
        if (docOnly.trim()) {
          canvasDraftForMsg = {
            id: pendingMsg.id,
            title: nextTitle,
            content: docOnly,
          }
          saveCanvasDraft({
            id: pendingMsg.id,
            conversationId,
            messageId: pendingMsg.id,
            title: nextTitle,
            content: docOnly,
            updatedAt: new Date().toISOString(),
          })
        }
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                content: forceCanvas ? canvasChatSummary : finalContent,
                thinking: finalThinking,
                streamStatus: undefined,
                pending: false,
                usage: finalUsage ?? m.usage,
                ...(canvasDraftForMsg ? { canvasDraft: canvasDraftForMsg } : {}),
              }
            : m,
        ),
      )

      // ── Persist to database ──────────────────────────────────────────────
      if (finalContent) {
        try {
          let convoId = conversationId
          // A brand-new conversation gets a real title from the model once the
          // first exchange is saved. Until then it needs *something*, so it
          // starts as the user's own words rather than sitting blank.
          let needsAutoTitle = false
          if (!convoId) {
            const title = text.slice(0, 80).replace(/\n/g, " ")
            const newConvo = await createChatConversation({ title, profileId: profile.id })
            convoId = newConvo.id
            needsAutoTitle = true
            setConversationId(convoId)
            queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })
          }

          const saved = await saveChatMessages({
            conversationId: convoId,
            messages: [
              { role: "user", content: displayUserText },
              {
                role: "assistant",
                // Canvas: store the short completion summary in chat history;
                // the full essay lives in the Canvas panel (and Save-to-Documents).
                content: forceCanvas ? canvasChatSummary || finalContent : finalContent,
                inputTokens: finalUsage?.inputTokens,
                outputTokens: finalUsage?.outputTokens,
                totalTokens: finalUsage?.totalTokens,
              },
            ],
          })
          setMessages((prev) =>
            applyPersistedMessageIds(prev, saved.messages, pendingMsg.id, userMsg.id, convoId),
          )
          queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })

          if (needsAutoTitle) {
            // Not awaited: the reply is already on screen, and a slow or failed
            // title should never hold up the chat. The rail refreshes when it lands.
            void autoTitleChatConversation(convoId)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations })
              })
              .catch(() => {
                /* keep the placeholder title */
              })
          }
        } catch {
          toast.error("Could not save to history", {
            description: "The reply still shows here, but won't appear in past conversations.",
          })
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) => applyAbortedAssistantMessage(prev, pendingMsg.id))
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, content: formatChatSendError(err), pending: false }
              : m,
          ),
        )
      }
    } finally {
      setStreaming(false)
      setStreamingMsgId(null)
      setCanvasStreaming(false)
      abortRef.current = null
    }
  }

  function stopGeneration() {
    if (!streaming) return
    abortRef.current?.abort()
  }

  const saveCanvasToDocuments = useCallback(
    async (format: CanvasExportFormat) => {
      const body = canvasContent.trim()
      if (!body || canvasStreaming || canvasSaving) return

      setCanvasSaving(true)
      try {
        const libraries = await getLibraries()
        const docsLib =
          libraries.find((l) => l.kind === "DOCUMENT") ||
          libraries.find((l) => l.slug === "documents") ||
          libraries.find((l) => /documents?/i.test(l.name))
        if (!docsLib) {
          toast.error("Documents library not found", {
            description: "Create or restore the Documents library first.",
          })
          return
        }

        const title = refineCanvasTitleFromContent(body, canvasTitle)
        setCanvasTitle(title)
        // Only fetched when a handwritten PDF is actually being made — the face
        // is 112 KB and every other export needs none of it.
        const handFont =
          canvasHandwriting && format === "pdf" ? await loadHandFont() : undefined
        const file = buildCanvasExportFile(title, body, format, {
          handwriting: canvasHandwriting,
          handFont,
        })

        await uploadFile(file, { targetLibraryId: docsLib.id })
        void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
        void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatContext })
        setCanvasSaveOpen(false)
        toast.success("Saved to Documents", {
          description: file.name,
        })
      } catch (err) {
        toast.error("Could not save to Documents", {
          description: err instanceof Error ? err.message : "Upload failed",
        })
      } finally {
        setCanvasSaving(false)
      }
    },
    [canvasContent, canvasHandwriting, canvasStreaming, canvasSaving, canvasTitle, queryClient],
  )

  const clearActiveCanvas = useCallback(() => {
    // Clear the panel only — past drafts stay on their chat messages / storage.
    setCanvasContent("")
    setCanvasTitle("Canvas")
    setActiveCanvasMessageId(null)
    toast.message("Canvas cleared", {
      description: "Earlier drafts stay on their chat messages — tap Open in Canvas to view them.",
    })
  }, [])

  const canvasVisible = canvasOpen || promptTools.includes("canvas")

  return (
    <ChatAttachProvider value={chatAttachValue}>
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
      {/* ── History sidebar (desktop/tablet rail; toggled from header chip) ─ */}
      <div
        className={cn(
          "hidden shrink-0 transition-[width] duration-200 sm:flex sm:flex-col",
          // A floating panel rather than a flush column: clear of the breadcrumb
          // that floats over the top of /chat, off the app sidebar on the left,
          // and ending level with the composer (which sits on pb-4).
          "pb-4 pl-2.5 pr-0 pt-[3.75rem]",
          // Canvas open on tablet: hide history rail so chat isn't crushed.
          historyOpen && !(canvasVisible)
            ? "sm:w-56 sm:overflow-visible lg:w-64"
            : historyOpen && canvasVisible
              ? "max-lg:w-0 max-lg:overflow-hidden lg:w-56 lg:overflow-visible"
              : "sm:w-0 sm:overflow-hidden sm:pl-0",
        )}
      >
        {historyOpen ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
            <HistorySidebar
              conversations={conversations}
              activeId={conversationId}
              loadingId={loadingConvoId}
              loading={historyQuery.isLoading}
              onSelect={loadConversation}
              onNew={startNewChat}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          </div>
        ) : null}
      </div>

      {/* ── Chat area ────────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          onWheel={handleMessagesWheel}
          onTouchMove={handleMessagesTouchMove}
          className="scrollbar-hide relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          onClick={() => { if (historyOpen) setHistoryOpen(false) }}
        >
          {/* Top bar: Clear only — History lives next to the breadcrumb in the header. */}
          <div className="pointer-events-none sticky top-0 z-20 flex items-center justify-end px-4 pt-3 sm:px-6">
            <div className="pointer-events-auto flex items-center gap-2 sm:hidden">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMobileHistoryOpen(true) }}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:text-foreground"
                title="Chat history"
              >
                <Clock className="size-3" />
                History
              </button>
            </div>

            {messages.length > 0 && (
              <div className="pointer-events-auto ml-auto flex items-center gap-2">
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
                  title="Start a new chat"
                >
                  <Plus className="size-3" />
                  New chat
                </button>
              </div>
            )}
          </div>

          {messages.length === 0 ? (
            /* Extra bottom pad so welcome content clears the floating composer */
            <div className="flex min-h-0 flex-1 flex-col pb-36 sm:pb-40">
              <WelcomeState
                hasProfiles={profiles.length > 0}
                locked={chatPaywalled}
                planLabel={chatPlanLabel}
                onSelectTemplate={(template) => {
                  if (chatLocked || streaming) return
                  void sendMessage(template.prompt)
                }}
              />
            </div>
          ) : (
            /* pb clears floating composer — messages scroll fully underneath empty air */
            <div
              ref={messagesInnerRef}
              className="relative flex flex-col gap-4 px-4 py-6 pb-40 sm:px-8 sm:pb-44 lg:px-16 xl:px-24"
            >
              {(() => {
                const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id
                return messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isLive={msg.id === streamingMsgId}
                  reasoningUiEnabled={reasoningUiEnabled}
                  isStreaming={streaming && msg.id === streamingMsgId}
                  canRegenerate={
                    !chatLocked &&
                    msg.role === "assistant" &&
                    msg.id === lastAssistantId &&
                    !streaming &&
                    !msg.pending
                  }
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
                  onOpenCanvasDraft={openCanvasDraft}
                  onPickSuggestion={(suggestion) => {
                    // Action chips run immediately — they do not ask the model
                    // anything, and routing "Save to Documents" through the
                    // assistant produced a refusal because it has no save tool.
                    if (suggestion.kind === "action") {
                      if (suggestion.action === "save-canvas") {
                        if (msg.canvasDraft) openCanvasDraft(msg.canvasDraft)
                        // PDF by default — the format people expect to hand
                        // to someone. The Canvas panel offers the others.
                        void saveCanvasToDocuments("pdf")
                      }
                      return
                    }
                    // Prompt chips fill, never send: a wrong guess would cost a
                    // whole generation and leave the reader undoing it.
                    // Long-form templates produce documents, so turn Canvas
                    // on rather than letting an essay arrive inline.
                    if (suggestion.enablesCanvas) {
                      setPromptTools((prev) =>
                        prev.includes("canvas") ? prev : [...prev, "canvas"],
                      )
                    }
                    setInput(suggestion.prompt)
                  }}
                  profileId={selectedProfile?.id}
                />
              ))
              })()}

            </div>
          )}
        </div>

        {/*
          Floating composer only — no solid bottom dock.
          Outer shell is pointer-events-none so message text under empty space
          stays visible and scrollable; only the prompt card captures clicks.
        */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 sm:px-6">
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <ChatPromptBox
              onEnableCanvas={() =>
                setPromptTools((prev) => (prev.includes("canvas") ? prev : [...prev, "canvas"]))
              }
              value={input}
              onValueChange={setInput}
              onSend={() => void sendMessage()}
              onStop={stopGeneration}
              streaming={streaming}
              locked={chatPaywalled}
              disabled={profiles.length === 0}
              placeholder={
                chatLocked
                  ? `Activate ${chatPlanLabel} to send messages…`
                  : streaming
                    ? "Generating… press Stop to interrupt"
                    : "Message Arciin…  Try /summarize"
              }
              profiles={profiles}
              selectedProfile={selectedProfile}
              selectedModel={selectedModel}
              onModelChange={(profile, model) => {
                if (chatLocked) return
                setSelectedProfile(profile)
                setSelectedModel(model)
                try {
                  localStorage.setItem(CHAT_SELECTED_PROFILE_ID_KEY, profile.id)
                  localStorage.setItem(CHAT_SELECTED_MODEL_KEY, model)
                } catch {
                  /* private mode */
                }
                void setChatSelection({ profileId: profile.id, model }).catch(() => {
                  /* offline */
                })
              }}
              ollamaShow={ollamaShowQuery.data}
              ollamaShowLoading={ollamaShowQuery.isFetching && !ollamaShowQuery.data}
              tools={promptTools}
              onToolsChange={handlePromptToolsChange}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
            />
            {chatLocked ? (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Free plan keeps this workspace visible.{" "}
                <Link
                  href="/settings?tab=license"
                  className="font-medium text-[color:var(--arciin-accent,#FF4F12)] underline decoration-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_40%,transparent)] underline-offset-2 hover:decoration-[color:var(--arciin-accent,#FF4F12)]"
                >
                  Activate license
                </Link>{" "}
                to chat with your files.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Canvas panel — full height; tablet uses a right overlay so chat isn't crushed ─ */}
      {canvasVisible ? (
        <div
          className={cn(
            // Small gap only on left (from chat); hug the right edge — less empty right padding.
            "hidden min-h-0 self-stretch py-2 pl-1 pr-0 md:flex md:flex-col",
            // Tablet (md–lg): float over chat as a sheet so the layout stays usable
            "max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[min(92vw,22rem)] max-lg:shadow-2xl",
            // Desktop: inline column next to chat
            "lg:relative lg:shrink-0 lg:w-[min(100%,26rem)] xl:w-[30rem]",
            // Arrives from the right rather than appearing. The panel opening is
            // a change of layout, and without the motion the whole column
            // snapped into place — read as a flicker rather than as something
            // sliding in beside the conversation.
            "motion-safe:animate-in motion-safe:slide-in-from-right-8 motion-safe:fade-in",
            "motion-safe:duration-300 motion-safe:ease-out",
          )}
        >
          <ChatCanvasPanel
            title={canvasTitle}
            content={canvasContent}
            handwriting={canvasHandwriting}
            onToggleHandwriting={() => setCanvasHandwriting((on) => !on)}
            streaming={canvasStreaming}
            saving={canvasSaving}
            onSave={() => setCanvasSaveOpen(true)}
            onClear={clearActiveCanvas}
            onClose={() => {
              setCanvasOpen(false)
              // Turn off the Canvas chip when the panel is dismissed.
              if (promptTools.includes("canvas")) {
                setPromptTools((prev) => prev.filter((t) => t !== "canvas"))
              }
            }}
          />
        </div>
      ) : null}

      {/* Phone canvas: full-height overlay */}
      {canvasVisible ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex py-2 pl-2 pr-0 md:hidden">
          {/* Same entrance on the phone overlay, where a panel appearing over
              the conversation without motion is even harder to follow. */}
          <div
            className={cn(
              "pointer-events-auto ml-auto flex h-full w-[min(100%,20rem)] flex-col",
              "motion-safe:animate-in motion-safe:slide-in-from-right-8 motion-safe:fade-in",
              "motion-safe:duration-300 motion-safe:ease-out",
            )}
          >
            <ChatCanvasPanel
              title={canvasTitle}
              content={canvasContent}
              streaming={canvasStreaming}
              saving={canvasSaving}
              handwriting={canvasHandwriting}
              onToggleHandwriting={() => setCanvasHandwriting((on) => !on)}
              onSave={() => setCanvasSaveOpen(true)}
              onClear={clearActiveCanvas}
              onClose={() => {
                setCanvasOpen(false)
                if (promptTools.includes("canvas")) {
                  setPromptTools((prev) => prev.filter((t) => t !== "canvas"))
                }
              }}
            />
          </div>
        </div>
      ) : null}

      <ChatCanvasSaveDialog
        open={canvasSaveOpen}
        onOpenChange={setCanvasSaveOpen}
        title={canvasTitle}
        saving={canvasSaving}
        selected={canvasSaveFormat}
        onSelect={setCanvasSaveFormat}
        onConfirm={() => void saveCanvasToDocuments(canvasSaveFormat)}
      />

      <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
        <SheetContent side="left" className="flex w-[min(100%,18rem)] flex-col gap-0 p-0 sm:max-w-xs">
          <SheetTitle className="sr-only">Chat history</SheetTitle>
          <HistorySidebar
            conversations={conversations}
            activeId={conversationId}
            loadingId={loadingConvoId}
            loading={historyQuery.isLoading}
            onSelect={(id) => void loadConversation(id)}
            onNew={() => {
              startNewChat()
              setMobileHistoryOpen(false)
            }}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        </SheetContent>
      </Sheet>
    </div>
    </ChatAttachProvider>
  )
}
