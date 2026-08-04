"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { prefetchOllamaAvailableModels } from "@/lib/hooks/use-ollama-available-models"
import { Clock, X } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { getOllamaModelShow } from "@/lib/api/models"
import { fetchApi } from "@/lib/api/client"
import {
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
  displayThinkingDuringStream,
  deriveStreamingThinkingAndAnswer,
  type Message,
  type TokenUsage,
} from "@/components/chat/chat-message-model"
import { finalizeAssistantContent, shouldAttachVisionToUserMessage } from "@/components/chat/chat-intent-helpers"
import { ARCIIN_DEFAULT_SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION_KEY, buildContextBlock } from "@/components/chat/chat-system-instruction"
import { MessageBubble } from "@/components/chat/chat-message-bubble"
import { WelcomeState } from "@/components/chat/chat-welcome-state"
import { HistorySidebar } from "@/components/chat/chat-history-sidebar"
import {
  ChatPromptBox,
  type ChatPromptToolId,
} from "@/components/chat/chat-prompt-box"
import {
  type ChatComposerAttachment,
  isImageMediaType,
} from "@/components/chat/chat-composer-attachments"
import {
  buildPromptToolsSystemAppend,
  promptToolsForceThinking,
  promptToolsForceVision,
} from "@/components/chat/chat-prompt-tools"
import { expandSlashMessage } from "@/components/chat/chat-slash-commands"

type ChatProfile = ChatProfilePicker

export function ChatPage() {
  const queryClient = useQueryClient()
  const license = useLicense()
  // Secure: treat as locked until license is confirmed free-or-paid (no Pro flash while loading)
  const chatLocked = !license.hasFeature("ai.chat")
  const chatPlanLabel = license.planLabel(license.requiredPlanFor("ai.chat") ?? "pro")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<ChatProfile | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [promptTools, setPromptTools] = useState<ChatPromptToolId[]>([])
  const [attachments, setAttachments] = useState<ChatComposerAttachment[]>([])
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
      setPromptTools(next)
      if (nowVision && !wasVision) {
        // Keep only image attachments when entering Vision mode.
        setAttachments((prev) => prev.filter((a) => isImageMediaType(a.mediaType)))
        void ensureVisionModel()
      }
    },
    [promptTools, ensureVisionModel],
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

  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = messagesScrollRef.current
    if (!el || !stickToBottomRef.current) return
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
      outer.scrollTo({ top: outer.scrollHeight, behavior: "auto" })
    }

    const ro = new ResizeObserver(bump)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [messages.length])

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
  }

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
              streamStatus = ""
            }
            if (json.usage) finalUsage = json.usage
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") throw parseErr
          }
        }
        const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showThinking)
        const displayThinking = displayThinkingDuringStream(reasoningUiEnabled, derived)
        const displayContent = finalizeAssistantContent(derived.answer, userText, priorMessages)
        flushSync(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingMsg.id
                ? {
                    ...m,
                    content: displayContent,
                    thinking: displayThinking,
                    streamStatus: streamStatus || undefined,
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

    // Display bubble: keep the human-typed slash line if we expanded.
    // Snapshot tray images so the bubble shows what was sent; tray stays
    // for follow-ups until the user removes attachments themselves.
    const displayUserText = (overrideText ?? input).trim() || text
    const attachedForBubble = imageAttachments
      .map((a) => a.imageBase64!)
      .slice(0, 3)
    const userMsg: Message = {
      id: createId(),
      role: "user",
      content: displayUserText,
      ...(attachedForBubble.length > 0 ? { images: attachedForBubble } : {}),
    }
    const pendingMsg: Message = {
      id: createId(),
      role: "assistant",
      content: "",
      pending: true,
      ...(turnReasoningUi ? { thinking: "" } : {}),
    }

    stickToBottomRef.current = true
    setMessages((prev) => [...prev, userMsg, pendingMsg])
    setInput("")
    setStreaming(true)

    type OutboundMsg = {
      role: "user" | "assistant" | "system"
      content: string
      images?: string[]
    }

    // Send expanded slash text to the model; keep the bubble as what the user typed.
    const history: OutboundMsg[] = [
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: text },
    ]
    const sysPrompt = systemInstruction.trim()

    const instanceBlock = contextQuery.data ? "\n\n" + buildContextBlock(contextQuery.data) : ""
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

    // Document attachments: steer the model at those files (no vision pixels).
    if (docAttachments.length > 0) {
      const names = docAttachments.map((d) => `"${d.filename}" (id=${d.assetId})`).join(", ")
      text =
        `${text}\n\n[Attached library file(s) for this turn: ${names}. ` +
        `Read with read_text_asset or read_pdf_asset. Answer only about these files — ` +
        `do not list the whole library.]`
      if (!activeTools.includes("files")) {
        activeTools = [...activeTools, "files"]
      }
    }

    let sysTail = instanceBlock + buildPromptToolsSystemAppend(activeTools)
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
              streamStatus = ""
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
        const displayContent = finalizeAssistantContent(derived.answer, text, messages)

        flushSync(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingMsg.id
                ? {
                    ...m,
                    content: displayContent,
                    thinking: displayThinking,
                    streamStatus: streamStatus || undefined,
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
              { role: "user", content: displayUserText },
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
      abortRef.current = null
    }
  }

  function stopGeneration() {
    if (!streaming) return
    abortRef.current?.abort()
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      {/* ── History sidebar ──────────────────────────────────────────────── */}
      <div
        className={cn(
          "hidden shrink-0 border-r border-border bg-card/60 transition-[width] duration-200 sm:flex sm:flex-col",
          historyOpen
            ? "sm:w-60 sm:overflow-visible lg:w-64"
            : "sm:w-0 sm:overflow-hidden sm:border-r-0",
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
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="scrollbar-hide relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          onClick={() => { if (historyOpen) setHistoryOpen(false) }}
        >
          {/* Floating top bar — overlays messages, never pushes layout */}
          <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-between px-4 pt-3 sm:px-6">
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMobileHistoryOpen(true) }}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground sm:hidden"
                title="Chat history"
              >
                <Clock className="size-3" />
                History
              </button>
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
            /* Extra bottom pad so welcome content clears the floating composer */
            <div className="flex min-h-0 flex-1 flex-col pb-36 sm:pb-40">
              <WelcomeState
                hasProfiles={profiles.length > 0}
                locked={chatLocked}
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
              value={input}
              onValueChange={setInput}
              onSend={() => void sendMessage()}
              onStop={stopGeneration}
              streaming={streaming}
              locked={chatLocked}
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
  )
}
