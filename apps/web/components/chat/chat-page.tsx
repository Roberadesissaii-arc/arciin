"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { prefetchOllamaAvailableModels } from "@/lib/hooks/use-ollama-available-models"
import {
  ArrowUp, Clock, Square, X,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Button } from "@/components/ui/button"
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
import { ChatModelPicker, type ChatProfilePicker } from "@/components/chat/chat-model-picker"
import {
  CHAT_SELECTED_MODEL_KEY,
  CHAT_SELECTED_PROFILE_ID_KEY,
} from "@/lib/chat/chat-selection-storage"
import { isOllamaProvider, ollamaCapabilitiesIncludeVision } from "@/lib/ollama-providers"
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
  const aiSettingsQuery = useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: ({ signal }) => getAiSettings(signal),
    staleTime: 30_000,
  })
  const showThinking = aiSettingsQuery.data?.showThinking ?? DEFAULT_AI_SETTINGS.showThinking

  const systemInstruction = typeof window !== "undefined"
    ? (localStorage.getItem(SYSTEM_INSTRUCTION_KEY) ?? ARCIIN_DEFAULT_SYSTEM_INSTRUCTION)
    : ARCIIN_DEFAULT_SYSTEM_INSTRUCTION

  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const messagesInnerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const abortRef       = useRef<AbortController | null>(null)

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

  // ── Input ──────────────────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
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

  async function sendMessage() {
    if (chatLocked) {
      toast.error(`${chatPlanLabel} required`, {
        description: `Activate ${chatPlanLabel} to send messages.`,
      })
      return
    }
    const text = input.trim()
    if (!text || streaming) return

    const profile = selectedProfile ?? profiles[0]
    if (!profile) {
      toast.error("No model selected", { description: "Connect one under Models first." })
      return
    }

    const userMsg: Message = { id: createId(), role: "user", content: text }
    const pendingMsg: Message = {
      id: createId(),
      role: "assistant",
      content: "",
      pending: true,
      ...(reasoningUiEnabled ? { thinking: "" } : {}),
    }

    stickToBottomRef.current = true
    setMessages((prev) => [...prev, userMsg, pendingMsg])
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    setStreaming(true)

    type OutboundMsg = {
      role: "user" | "assistant" | "system"
      content: string
      images?: string[]
    }

    const history: OutboundMsg[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const sysPrompt = systemInstruction.trim()

    const instanceBlock = contextQuery.data ? "\n\n" + buildContextBlock(contextQuery.data) : ""
    const caps = ollamaShowQuery.data?.capabilities
    const visionCapable =
      ollamaChat &&
      (ollamaCapabilitiesIncludeVision(caps) !== false ||
        /qwen3\.5|llava|gemma.*vision|minicpm-v|moondream|bakllava/i.test(activeModelLabel))

    const modelToSend = selectedModel || profile.defaultModel || undefined

    let visionImages: string[] | undefined
    if (visionCapable && shouldAttachVisionToUserMessage(text, messages)) {
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

    let sysTail = instanceBlock
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

        const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showThinking)
        const displayThinking = displayThinkingDuringStream(reasoningUiEnabled, derived)
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
        showThinking,
        reasoningUiEnabled,
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
              { role: "user", content: text },
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (streaming) {
        stopGeneration()
      } else {
        sendMessage()
      }
    }
  }

  const canSend =
    !chatLocked && input.trim().length > 0 && !streaming && profiles.length > 0
  const canStop = streaming && profiles.length > 0

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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <WelcomeState
              hasProfiles={profiles.length > 0}
              locked={chatLocked}
              planLabel={chatPlanLabel}
            />
          ) : (
            <div ref={messagesInnerRef} className="relative flex flex-col gap-4 px-4 py-6 pb-8 sm:px-8 lg:px-16 xl:px-24">
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

        {/* Input pill — always visible; disabled when plan is Free */}
        <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div
              className={cn(
                "flex min-h-[54px] items-center gap-0 rounded-2xl border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-primary/20",
                chatLocked && "opacity-90",
              )}
            >
              <ChatModelPicker
                profiles={profiles}
                selectedProfile={selectedProfile}
                selectedModel={selectedModel}
                lightSurface
                onChange={(profile, model) => {
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
              />
              <div className="h-5 w-px shrink-0 bg-border" />
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  chatLocked
                    ? `Activate ${chatPlanLabel} to send messages…`
                    : streaming
                      ? "Generating… press Stop to interrupt"
                      : "Message…"
                }
                disabled={chatLocked || profiles.length === 0}
                readOnly={chatLocked}
                className="min-h-[54px] flex-1 resize-none bg-transparent px-3 py-4 text-[14px] leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="flex shrink-0 items-center px-2">
                {canStop ? (
                  <Button
                    type="button"
                    size="icon"
                    onClick={stopGeneration}
                    title="Stop generating"
                    aria-label="Stop generating"
                    className="size-8 rounded-xl bg-destructive text-white hover:bg-destructive/90"
                  >
                    <Square className="size-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    disabled={!canSend}
                    onClick={sendMessage}
                    title={chatLocked ? `Requires ${chatPlanLabel}` : "Send message"}
                    aria-label="Send message"
                    className="size-8 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                )}
              </div>
            </div>
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
