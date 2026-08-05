"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUp,
  Brain,
  Eye,
  FileText,
  FolderOpen,
  Library,
  Loader2,
  Mic,
  Paperclip,
  PenLine,
  Square,
  X,
} from "lucide-react"

import {
  ChatModelPicker,
  type ChatProfilePicker,
} from "@/components/chat/chat-model-picker"
import {
  type ChatComposerAttachment,
  attachmentThumbUrl,
  isAttachableMediaType,
  isImageMediaType,
} from "@/components/chat/chat-composer-attachments"
import {
  filterSlashCommands,
  getActiveSlashQuery,
  splitTextForSlashHighlight,
  type ChatSlashCommand,
} from "@/components/chat/chat-slash-commands"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSpeechToText } from "@/hooks/use-speech-to-text"
import { getAssets } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { loadAssetImageBase64 } from "@/lib/chat/load-asset-image-base64"
import { cn } from "@/lib/utils"
import type { OllamaModelShowData } from "@/lib/types/models"
import type { AssetSummary } from "@/lib/types/models"
import { fmtBytes } from "@/components/chat/chat-format"

export type ChatPromptToolId = "library" | "files" | "vision" | "thinking" | "canvas"

type ChatPromptBoxProps = {
  value: string
  onValueChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  locked?: boolean
  placeholder?: string
  className?: string
  profiles: ChatProfilePicker[]
  selectedProfile: ChatProfilePicker | null
  selectedModel: string
  onModelChange: (profile: ChatProfilePicker, model: string) => void
  ollamaShow?: OllamaModelShowData
  ollamaShowLoading?: boolean
  tools?: ChatPromptToolId[]
  onToolsChange?: (tools: ChatPromptToolId[]) => void
  /** Library attachments (images + docs). Images may include base64 for vision. */
  attachments?: ChatComposerAttachment[]
  onAttachmentsChange?: (next: ChatComposerAttachment[]) => void
}

const TOOLS: {
  id: ChatPromptToolId
  label: string
  icon: typeof Library
  hint: string
}[] = [
  {
    id: "library",
    label: "Library",
    icon: Library,
    hint: "On: force library tools — list media, search folders, organize.",
  },
  {
    id: "files",
    label: "Files",
    icon: FolderOpen,
    hint: "On: force open/read/summarize stored files. Use with /summarize or Attach.",
  },
  {
    id: "vision",
    label: "Vision",
    icon: Eye,
    hint: "On: switches to a vision model. Attach an image with the paperclip.",
  },
  {
    id: "thinking",
    label: "Think",
    icon: Brain,
    hint: "On: show the reasoning panel for this turn. Off: answer only.",
  },
  {
    id: "canvas",
    label: "Canvas",
    icon: PenLine,
    hint: "On: long-form writing (essays, drafts) opens in Canvas. Chat shows progress only.",
  },
]

const ACCENT = "text-[color:var(--arciin-accent,#FF4F12)]"

function OrangeDivider() {
  return (
    <div className="relative mx-1 h-6 w-px shrink-0" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-transparent via-primary to-transparent" />
    </div>
  )
}

/**
 * Multi-row composer:
 * slash menu · highlighted input · attach + tool chips · model · mic/send
 */
export function ChatPromptBox({
  value,
  onValueChange,
  onSend,
  onStop,
  streaming,
  disabled = false,
  locked = false,
  placeholder = "Message…  Try /summarize",
  className,
  profiles,
  selectedProfile,
  selectedModel,
  onModelChange,
  ollamaShow,
  ollamaShowLoading,
  tools = [],
  onToolsChange,
  attachments = [],
  onAttachmentsChange,
}: ChatPromptBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const slashListRef = useRef<HTMLDivElement>(null)
  const speechBaseRef = useRef(value)
  const [localTools, setLocalTools] = useState<ChatPromptToolId[]>(tools)
  const [slashIndex, setSlashIndex] = useState(0)
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachBusyId, setAttachBusyId] = useState<string | null>(null)
  const activeTools = onToolsChange ? tools : localTools
  const {
    listening,
    supported: speechSupported,
    error: speechError,
    toggleListening,
    stop: stopSpeech,
  } = useSpeechToText()

  const visionOn = activeTools.includes("vision")

  const toolsKey = tools.join(" ")
  const [lastToolsKey, setLastToolsKey] = useState(toolsKey)
  if (!onToolsChange && toolsKey !== lastToolsKey) {
    setLastToolsKey(toolsKey)
    setLocalTools(tools)
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  useEffect(() => {
    if (streaming || locked || disabled) stopSpeech()
  }, [streaming, locked, disabled, stopSpeech])

  const setTools = (next: ChatPromptToolId[]) => {
    if (onToolsChange) onToolsChange(next)
    else setLocalTools(next)
  }

  const toggleTool = (id: ChatPromptToolId) => {
    if (disabled || locked) return
    if (activeTools.includes(id)) setTools(activeTools.filter((t) => t !== id))
    else setTools([...activeTools, id])
  }

  const [cursor, setCursor] = useState(value.length)
  const syncCursor = (el: HTMLTextAreaElement) => setCursor(el.selectionStart ?? value.length)

  const slashActive = useMemo(
    () => getActiveSlashQuery(value, cursor),
    [value, cursor],
  )
  const slashMatches = useMemo(
    () => (slashActive ? filterSlashCommands(slashActive.query) : []),
    [slashActive],
  )
  const slashOpen = Boolean(slashActive && slashMatches.length > 0 && !locked && !disabled)

  const slashResetKey = `${slashActive?.query ?? ""}|${slashOpen}`
  const [lastSlashResetKey, setLastSlashResetKey] = useState(slashResetKey)
  if (slashResetKey !== lastSlashResetKey) {
    setLastSlashResetKey(slashResetKey)
    setSlashIndex(0)
  }

  useEffect(() => {
    if (!slashOpen) return
    const el = slashListRef.current
    if (!el) return
    const item = el.querySelector<HTMLElement>(`[data-slash-index="${slashIndex}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [slashIndex, slashOpen])

  // Library picker — images when Vision is on; images + documents otherwise (no audio).
  const attachQuery = useQuery({
    queryKey: queryKeys.assets({
      _chatAttach: true,
      vision: visionOn,
    }),
    queryFn: async ({ signal }) => {
      if (visionOn) {
        return getAssets({ mediaType: "IMAGE" }, signal)
      }
      const [images, docs, videos, code] = await Promise.all([
        getAssets({ mediaType: "IMAGE" }, signal),
        getAssets({ mediaType: "DOCUMENT" }, signal),
        getAssets({ mediaType: "VIDEO" }, signal),
        getAssets({ category: "code" }, signal),
      ])
      const map = new Map<string, AssetSummary>()
      for (const a of [...images, ...docs, ...videos, ...code]) {
        if (isAttachableMediaType(a.mediaType)) map.set(a.id, a)
      }
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
    },
    enabled: attachOpen && !locked && !disabled,
    staleTime: 20_000,
  })

  const pickableAssets = useMemo(() => {
    const list = attachQuery.data ?? []
    if (visionOn) return list.filter((a) => a.mediaType === "IMAGE").slice(0, 48)
    return list.slice(0, 48)
  }, [attachQuery.data, visionOn])

  const applySlash = (cmd: ChatSlashCommand) => {
    if (!slashActive) return
    // Guarantee exactly one space after the command so the caret is ready for args.
    const token = `/${cmd.name} `
    const before = value.slice(0, slashActive.replaceStart)
    const afterRaw = value.slice(slashActive.replaceEnd).replace(/^\s*/, "")
    const normalized = `${before}${token}${afterRaw}`
    onValueChange(normalized)
    const merged = Array.from(new Set([...activeTools, ...cmd.tools]))
    setTools(merged)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      // Caret after "/name " — not inside the orange function token.
      const pos = before.length + token.length
      el.setSelectionRange(pos, pos)
      setCursor(pos)
    })
  }

  const hasContent = value.trim().length > 0 || attachments.length > 0
  const canSend =
    !locked &&
    !disabled &&
    (value.trim().length > 0 || attachments.length > 0) &&
    !streaming &&
    profiles.length > 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        if (cmd) applySlash(cmd)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (listening) stopSpeech()
      if (streaming) onStop()
      else if (canSend) onSend()
    }
  }

  const startDictation = () => {
    if (!speechSupported || locked || disabled || streaming) return
    speechBaseRef.current = value
    toggleListening((text, isFinal) => {
      const base = speechBaseRef.current
      const merged = isFinal
        ? `${base}${base && !base.endsWith(" ") ? " " : ""}${text.trim()}`
        : `${base}${text}`
      onValueChange(merged)
      if (isFinal) speechBaseRef.current = merged
    })
  }

  const primaryAction = () => {
    if (listening) {
      stopSpeech()
      return
    }
    if (streaming) {
      onStop()
      return
    }
    if (hasContent) {
      if (canSend) onSend()
      return
    }
    startDictation()
  }

  const removeAttachment = (assetId: string) => {
    if (!onAttachmentsChange) return
    onAttachmentsChange(attachments.filter((a) => a.assetId !== assetId))
  }

  const selectLibraryAsset = async (asset: AssetSummary) => {
    if (!onAttachmentsChange || locked || disabled) return
    if (attachments.some((a) => a.assetId === asset.id)) {
      setAttachOpen(false)
      return
    }
    if (attachments.length >= 4) return

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
      onAttachmentsChange([...attachments, next].slice(0, 4))
      // Image → Vision; documents/code → Files so follow-ups (/summarize, describe) work.
      if (isImageMediaType(asset.mediaType)) {
        if (!activeTools.includes("vision")) {
          setTools([...activeTools.filter((t) => t !== "files"), "vision"])
        }
      } else if (!activeTools.includes("files")) {
        setTools([...activeTools, "files"])
      }
      setAttachOpen(false)
    } finally {
      setAttachBusyId(null)
    }
  }

  const highlightParts = splitTextForSlashHighlight(value)

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={boxRef}
        className={cn(
          "relative rounded-3xl border border-border bg-card p-2 shadow-sm transition-shadow",
          "focus-within:border-primary/35 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/15",
          streaming && "border-primary/40",
          locked && "opacity-90",
          className,
        )}
      >
        {/* Slash command palette — ~4 medium-round rows, no scrollbar */}
        {slashOpen ? (
          <div
            className={cn(
              "absolute bottom-full left-2 right-2 z-40 mb-2",
              "rounded-2xl border border-border bg-card shadow-lg ring-1 ring-black/5",
            )}
            role="listbox"
            aria-label="Slash commands"
          >
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Commands · type to filter
            </p>

            <div
              ref={slashListRef}
              className={cn(
                // Fixed-height rows; no scrollbar chrome / no up-down chevrons
                "max-h-[17rem] space-y-1.5 overflow-y-auto overflow-x-hidden px-2 py-1.5",
                "[scrollbar-width:none] [-ms-overflow-style:none]",
                "[&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:bg-transparent",
              )}
            >
              {slashMatches.map((cmd, i) => (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  data-slash-index={i}
                  aria-selected={i === slashIndex}
                  className={cn(
                    // Fixed card height so long descriptions don't stretch the row
                    "flex h-[3.85rem] w-full flex-col justify-center gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
                    i === slashIndex
                      ? "bg-primary/15 text-foreground"
                      : "text-foreground hover:bg-primary/10",
                  )}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => applySlash(cmd)}
                >
                  <span className={cn("shrink-0 text-[12px] font-semibold", ACCENT)}>
                    /{cmd.name}
                  </span>
                  <span className="line-clamp-1 text-[11px] leading-snug text-muted-foreground">
                    {cmd.description}
                  </span>
                  <span className={cn("line-clamp-1 text-[10px] leading-snug opacity-80", ACCENT)}>
                    {cmd.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Library attach picker */}
        {attachOpen ? (
          <div
            className={cn(
              "absolute bottom-full left-2 right-2 z-40 mb-2 max-h-72 overflow-hidden",
              "rounded-2xl border border-border bg-card shadow-lg ring-1 ring-black/5",
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-[11px] font-semibold text-foreground">
                {visionOn ? "Attach image from library" : "Attach from library"}
              </p>
              <button
                type="button"
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setAttachOpen(false)}
                aria-label="Close attach picker"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto p-2 scrollbar-thin">
              {attachQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading…
                </div>
              ) : pickableAssets.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                  {visionOn
                    ? "No images in your library yet."
                    : "No attachable files found (images & documents)."}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {pickableAssets.map((asset) => {
                    const selected = attachments.some((a) => a.assetId === asset.id)
                    const busy = attachBusyId === asset.id
                    const isImg = asset.mediaType === "IMAGE"
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        disabled={busy || selected}
                        onClick={() => void selectLibraryAsset(asset)}
                        className={cn(
                          "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-muted/30 text-left transition-colors",
                          "hover:border-primary/40 hover:bg-primary/[0.04]",
                          selected && "border-primary/50 ring-1 ring-primary/30",
                          busy && "opacity-60",
                        )}
                      >
                        <div className="relative aspect-square bg-muted/50">
                          {isImg || asset.mediaType === "VIDEO" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={attachmentThumbUrl(asset.id)}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground/50">
                              <FileText className="size-6" />
                            </div>
                          )}
                          {busy ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Loader2 className="size-4 animate-spin text-white" />
                            </div>
                          ) : null}
                        </div>
                        <div className="px-1.5 py-1">
                          <p className="truncate text-[10px] font-medium text-foreground">
                            {asset.originalFilename}
                          </p>
                          <p className="truncate text-[9px] text-muted-foreground">
                            {fmtBytes(asset.sizeBytes)}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Attachment chips (no helper sentence) */}
        {attachments.length > 0 ? (
          <div className="mb-1 flex flex-wrap items-center gap-2 px-2 pt-1">
            {attachments.map((att) => (
              <div
                key={att.assetId}
                className="relative flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 pr-1"
              >
                {isImageMediaType(att.mediaType) && att.imageBase64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/jpeg;base64,${att.imageBase64}`}
                    alt=""
                    className="size-11 rounded-l-[10px] object-cover"
                  />
                ) : isImageMediaType(att.mediaType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachmentThumbUrl(att.assetId)}
                    alt=""
                    className="size-11 rounded-l-[10px] object-cover"
                  />
                ) : (
                  <div className="flex size-11 items-center justify-center rounded-l-[10px] bg-muted">
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                )}
                <span className="max-w-[7rem] truncate text-[10px] font-medium text-foreground">
                  {att.filename}
                </span>
                {onAttachmentsChange ? (
                  <button
                    type="button"
                    className="mr-0.5 flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove ${att.filename}`}
                    onClick={() => removeAttachment(att.assetId)}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Input with orange slash-command highlight overlay */}
        <div className="relative">
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words",
              "px-3 py-2.5 text-[14px] leading-snug",
            )}
          >
            {value.length === 0 ? (
              <span className="text-transparent">.</span>
            ) : (
              // Same font metrics as the textarea (no mono/bold) so the caret
              // stays aligned after /summarize␠ when typing the filename.
              highlightParts.map((part, i) =>
                part.isCommand ? (
                  <span
                    key={i}
                    className="font-medium text-[color:var(--arciin-accent,#FF4F12)]"
                  >
                    {part.text}
                  </span>
                ) : (
                  <span key={i} className="text-foreground">
                    {part.text}
                  </span>
                ),
              )
            )}
          </div>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              onValueChange(e.target.value)
              syncCursor(e.currentTarget)
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => syncCursor(e.currentTarget)}
            onSelect={(e) => syncCursor(e.currentTarget)}
            placeholder={placeholder}
            disabled={disabled || locked || profiles.length === 0}
            readOnly={locked}
            className={cn(
              "relative min-h-[48px] w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-snug",
              "caret-foreground placeholder:text-muted-foreground",
              // Transparent text so the orange overlay shows; caret stays visible
              "text-transparent",
              "focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
              "scrollbar-thin",
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1 pt-0.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {/* Attach — outside the tool-chip rail (no divider around paperclip). */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled || locked}
                  onClick={() => setAttachOpen((v) => !v)}
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-full border transition-colors",
                    attachOpen || attachments.length > 0
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                    (disabled || locked) && "pointer-events-none opacity-50",
                  )}
                  aria-label="Attach from library"
                  aria-expanded={attachOpen}
                >
                  <Paperclip className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                showArrow={false}
                className={cn(
                  "max-w-[14rem] rounded-xl border border-zinc-700/90 bg-zinc-950 px-3.5 py-2.5",
                  "text-[11px] leading-snug text-zinc-100 shadow-xl ring-1 ring-white/10",
                )}
              >
                {visionOn
                  ? "Attach an image from your library for Vision"
                  : "Attach an image or document from your library"}
              </TooltipContent>
            </Tooltip>

            {/* Tool rail: | Library · Files · Vision · Think · Canvas | */}
            <OrangeDivider />
            {TOOLS.map((tool) => {
              const Icon = tool.icon
              const on = activeTools.includes(tool.id)
              return (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled || locked}
                      onClick={() => toggleTool(tool.id)}
                      className={cn(
                        "inline-flex h-8 items-center justify-center rounded-full border text-[11px] font-semibold transition-all",
                        // Active: expand to icon + label. Inactive: icon only.
                        on
                          ? "gap-1.5 border-primary/40 bg-primary/10 px-2.5 text-primary"
                          : "size-8 border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                        (disabled || locked) && "pointer-events-none opacity-50",
                      )}
                      aria-pressed={on}
                      aria-label={tool.label}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      {on ? <span className="max-w-[5.5rem] truncate">{tool.label}</span> : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={8}
                    showArrow={false}
                    className={cn(
                      "max-w-[16rem] rounded-xl border border-zinc-700/90 bg-zinc-950 px-3.5 py-2.5",
                      "text-[11px] leading-snug text-zinc-100 shadow-xl shadow-black/40",
                      "ring-1 ring-white/10",
                    )}
                  >
                    {on ? tool.hint : `${tool.label} — ${tool.hint}`}
                  </TooltipContent>
                </Tooltip>
              )
            })}
            <OrangeDivider />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* Straight line in front of model selection (same style as tool rail). */}
            <OrangeDivider />

            <div className="min-w-0">
              <ChatModelPicker
                profiles={profiles}
                selectedProfile={selectedProfile}
                selectedModel={selectedModel}
                lightSurface
                compact
                menuGap={12}
                menuAnchorRef={boxRef}
                onChange={(profile, model) => {
                  if (locked || disabled) return
                  onModelChange(profile, model)
                }}
                ollamaShow={ollamaShow}
                ollamaShowLoading={ollamaShowLoading}
              />
            </div>

            <OrangeDivider />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  disabled={
                    listening
                      ? false
                      : streaming
                        ? false
                        : hasContent
                          ? !canSend
                          : locked || disabled || !speechSupported
                  }
                  onClick={primaryAction}
                  title={
                    listening
                      ? "Stop listening"
                      : streaming
                        ? "Stop generating"
                        : hasContent
                          ? locked
                            ? "Plan required"
                            : "Send message"
                          : speechSupported
                            ? "Dictate with microphone"
                            : "Speech not supported in this browser"
                  }
                  aria-label={
                    listening
                      ? "Stop listening"
                      : streaming
                        ? "Stop generating"
                        : hasContent
                          ? "Send message"
                          : "Dictate message"
                  }
                  className={cn(
                    "size-9 rounded-full shadow-sm transition-all",
                    listening
                      ? "bg-primary text-white ring-2 ring-primary/35 hover:bg-primary/90 animate-pulse"
                      : streaming
                        ? "bg-destructive text-white hover:bg-destructive/90"
                        : hasContent
                          ? "bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
                          : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {listening ? (
                    <Square className="size-3.5 fill-current" />
                  ) : streaming ? (
                    <Square className="size-3.5 fill-current" />
                  ) : hasContent ? (
                    <ArrowUp className="size-4" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                showArrow={false}
                className={cn(
                  "rounded-xl border border-zinc-700/90 bg-zinc-950 px-3.5 py-2.5",
                  "text-[11px] leading-snug text-zinc-100 shadow-xl shadow-black/40 ring-1 ring-white/10",
                )}
              >
                {listening
                  ? "Stop listening"
                  : streaming
                    ? "Stop"
                    : hasContent
                      ? "Send"
                      : speechSupported
                        ? "Click and speak — text fills the box"
                        : "Speech not supported in this browser"}
                {speechError ? (
                  <span className="mt-1 block text-amber-300">{speechError}</span>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
