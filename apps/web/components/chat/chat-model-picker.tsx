"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Brain, ChevronDown, Cloud, Eye, Info, Loader2, Sparkles } from "lucide-react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import {
  filterModelsForAssetNeed,
  modelNameLooksVision,
  providerIsMultimodal,
  type AssetChatModelNeed,
} from "@/lib/chat/asset-chat-model"
import { PROVIDER_MODELS } from "@/lib/chat/provider-models"
import {
  ollamaCapabilityMap,
  useOllamaModelCapabilities,
} from "@/lib/hooks/use-ollama-model-capabilities"
import { useOllamaAvailableModels } from "@/lib/hooks/use-ollama-available-models"
import { isOllamaProvider } from "@/lib/ollama-providers"
import { cn } from "@/lib/utils"
import type { OllamaModelShowData } from "@/lib/types/models"

export type ChatProfilePicker = {
  id: string
  provider: string
  displayName: string
  defaultModel: string | null
  isDefault: boolean
  isEnabled?: boolean
}

const LIGHT_MENU = "border-zinc-200 bg-white text-zinc-900"

/** Cloud → vision eye → thinking — icons only (capabilities from Ollama /api/show). */
function ModelRowTrailingIcons({
  isCloud,
  vision,
  thinking,
  lightSurface,
}: {
  isCloud: boolean
  vision: boolean
  thinking: boolean
  lightSurface?: boolean
}) {
  if (!isCloud && !vision && !thinking) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {isCloud ? (
        <Cloud className="size-3.5 shrink-0 opacity-45" aria-label="Ollama Cloud" />
      ) : null}
      {vision ? (
        <Eye
          className={cn(
            "size-3.5 shrink-0",
            lightSurface ? "text-violet-600" : "text-violet-400",
          )}
          aria-label="Vision — supports images"
        />
      ) : null}
      {thinking ? (
        <Brain
          className={cn(
            "size-3.5 shrink-0 opacity-70",
            lightSurface ? "text-sky-600" : "text-sky-400",
          )}
          aria-label="Thinking — reasoning traces"
        />
      ) : null}
    </span>
  )
}

function OllamaProfileSection({
  profile,
  selectedProfile,
  selectedModel,
  onSelect,
  filterModels,
  assetModelNeed,
  capabilitiesEnabled,
  lightSurface,
}: {
  profile: ChatProfilePicker
  selectedProfile: ChatProfilePicker | null
  selectedModel: string
  onSelect: (model: string) => void
  filterModels?: (models: string[]) => string[]
  assetModelNeed?: AssetChatModelNeed
  /** When true, batch-fetch Ollama /api/show per model tag */
  capabilitiesEnabled?: boolean
  lightSurface?: boolean
}) {
  const isCloud = profile.provider === "ollama-cloud"
  const q = useOllamaAvailableModels(profile.id)

  const raw =
    q.data?.models ?? (profile.defaultModel ? [profile.defaultModel] : [])

  const capQuery = useOllamaModelCapabilities(
    profile.id,
    raw,
    Boolean(capabilitiesEnabled && raw.length > 0),
  )
  const capMap = ollamaCapabilityMap(capQuery.data?.entries)
  const capsProbing = capQuery.isFetching && capMap.size === 0

  const models =
    assetModelNeed != null
      ? filterModelsForAssetNeed(raw, assetModelNeed, capMap)
      : filterModels
        ? filterModels(raw)
        : raw
  const fromCache = q.data?.fromCache ?? false
  const showLoading = q.isPending && models.length === 0
  const showProbing = q.isFetching && !fromCache && isCloud
  const errorMessage =
    q.error instanceof Error ? q.error.message : q.isError ? "Could not load models." : null

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
          lightSurface
            ? "border-zinc-200 bg-white text-zinc-500"
            : "border-border/60 bg-card text-muted-foreground",
        )}
      >
        <span className="flex items-center gap-2">
          {profile.displayName}
          {showProbing ? (
            <Loader2 className="size-2.5 animate-spin opacity-60" aria-hidden />
          ) : null}
          {capsProbing ? (
            <span className="normal-case tracking-normal text-[9px] font-medium text-muted-foreground/80">
              checking vision…
            </span>
          ) : null}
        </span>
        {profile.isDefault ? (
          <span className="rounded bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
            Default
          </span>
        ) : null}
      </div>
      {errorMessage && models.length > 0 ? (
        <p
          className={cn(
            "border-b px-3 py-2 text-[10px] leading-snug text-amber-700/90",
            lightSurface ? "border-zinc-100" : "border-border/40",
          )}
        >
          {errorMessage}
        </p>
      ) : null}
      {showLoading ? (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-3 text-[11px]",
            lightSurface ? "text-zinc-500" : "text-muted-foreground",
          )}
        >
          <Loader2 className="size-3 animate-spin" />
          {isCloud && !fromCache
            ? "First-time cloud model check…"
            : isCloud
              ? "Loading cloud models…"
              : "Fetching models…"}
        </div>
      ) : models.length === 0 ? (
        <div
          className={cn(
            "px-3 py-2.5 text-[11px]",
            lightSurface ? "text-zinc-500" : "text-muted-foreground",
          )}
        >
          {errorMessage ??
            (isCloud
              ? "No working cloud models yet. Check your API key under Models → Ollama Cloud."
              : "No models found. Run ollama pull or check your Ollama instance.")}
        </div>
      ) : (
        models.map((model) => {
          const active =
            selectedProfile?.id === profile.id &&
            (selectedModel === model ||
              (!selectedModel && model === profile.defaultModel))
          return (
            <button
              key={model}
              type="button"
              onClick={() => onSelect(model)}
              className={cn(
                "flex w-full items-center gap-2 border-b px-3 py-2.5 text-left font-mono text-[12px] last:border-0 transition-colors",
                lightSurface ? "border-zinc-100" : "border-border/40",
                active
                  ? lightSurface
                    ? "bg-[#fff4f0] text-[#c2410c]"
                    : "bg-primary/[0.07] text-primary"
                  : lightSurface
                    ? "text-zinc-800 hover:bg-zinc-50"
                    : "text-foreground hover:bg-muted/50",
              )}
            >
              <span className="flex-1 truncate">{model}</span>
              <ModelRowTrailingIcons
                isCloud={isCloud}
                vision={capMap.get(model)?.vision ?? false}
                thinking={capMap.get(model)?.thinking ?? false}
                lightSurface={lightSurface}
              />
              {active ? (
                <span
                  className={cn(
                    "shrink-0 text-[9px] font-semibold uppercase tracking-wide",
                    lightSurface ? "text-[#ff4f12]/80" : "text-primary/60",
                  )}
                >
                  active
                </span>
              ) : null}
            </button>
          )
        })
      )}
    </>
  )
}

function OllamaModelInfoHover({
  loading,
  data,
  lightSurface,
}: {
  loading: boolean
  data: OllamaModelShowData | undefined
  lightSurface?: boolean
}) {
  const caps = data?.capabilities ?? []
  const d = data?.details
  const paramLines = (data?.parameters ?? "")
    .split("\n")
    .filter(Boolean)
    .slice(0, 8)
    .join("\n")

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="ml-0.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title="Model details (Ollama)"
          aria-label="Model details"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Info className="size-3.5" />
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        className={cn(
          "w-80 space-y-2.5 text-[11px]",
          lightSurface && "dashboard-main border-zinc-200 bg-white text-zinc-900",
        )}
        align="start"
        side="top"
      >
        {loading && !data ? (
          <p className="text-muted-foreground">Loading model metadata…</p>
        ) : !data ? (
          <p className="text-muted-foreground">No metadata yet.</p>
        ) : (
          <>
            {caps.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {caps.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {(d?.parameter_size || d?.quantization_level || d?.format) ? (
              <div className="space-y-0.5 text-muted-foreground">
                {d.parameter_size ? (
                  <p>
                    <span className="text-foreground/80">Size</span> · {d.parameter_size}
                  </p>
                ) : null}
                {d.quantization_level ? (
                  <p>
                    <span className="text-foreground/80">Quant</span> · {d.quantization_level}
                  </p>
                ) : null}
                {d.format ? (
                  <p>
                    <span className="text-foreground/80">Format</span> · {d.format}
                  </p>
                ) : null}
              </div>
            ) : null}
            {data.modified_at ? (
              <p className="text-muted-foreground/80">
                <span className="text-foreground/80">Modified</span> · {data.modified_at}
              </p>
            ) : null}
            {paramLines ? (
              <pre className="scrollbar-hide max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
                {paramLines}
              </pre>
            ) : null}
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function ScrollFadeList({
  children,
  maxHeightClass = "max-h-80",
  className,
}: {
  children: React.ReactNode
  maxHeightClass?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showMore, setShowMore] = useState(false)

  const checkOverflow = useCallback(() => {
    const el = ref.current
    if (!el) return
    setShowMore(el.scrollHeight > el.clientHeight + 6)
  }, [])

  useEffect(() => {
    checkOverflow()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(checkOverflow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [checkOverflow, children])

  return (
    <div className="relative">
      <div
        ref={ref}
        className={cn(
          maxHeightClass,
          "scrollbar-hide overflow-y-auto overflow-x-hidden",
          className,
        )}
      >
        {children}
      </div>
      {showMore ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1.5 pt-10",
            className?.includes("bg-white")
              ? "bg-gradient-to-t from-white via-white/95 to-transparent"
              : "bg-gradient-to-t from-card via-card/95 to-transparent",
          )}
          aria-hidden
        >
          <ChevronDown className="size-4 text-muted-foreground/80" />
        </div>
      ) : null}
    </div>
  )
}

function ModelPickerMenu({
  enabledProfiles,
  selectedProfile,
  selectedModel,
  onChange,
  onPick,
  filterOllamaModels,
  assetModelNeed,
  capabilitiesEnabled,
  lightSurface,
}: {
  enabledProfiles: ChatProfilePicker[]
  selectedProfile: ChatProfilePicker | null
  selectedModel: string
  onChange: (profile: ChatProfilePicker, model: string) => void
  onPick: () => void
  filterOllamaModels?: (models: string[]) => string[]
  assetModelNeed?: AssetChatModelNeed
  capabilitiesEnabled?: boolean
  lightSurface?: boolean
}) {
  if (enabledProfiles.length === 0) {
    return (
      <div
        className={cn(
          "px-3 py-4 text-center text-[12px]",
          lightSurface ? "text-zinc-600" : "text-muted-foreground",
        )}
      >
        No models connected.{" "}
        <Link
          href="/models"
          className={cn(
            "underline-offset-4 hover:underline",
            lightSurface ? "text-[#ff4f12]" : "text-primary",
          )}
        >
          Configure models
        </Link>
      </div>
    )
  }

  return (
    <>
      {enabledProfiles.map((profile) => {
        if (isOllamaProvider(profile.provider)) {
          return (
            <div key={profile.id}>
              <OllamaProfileSection
                profile={profile}
                selectedProfile={selectedProfile}
                selectedModel={selectedModel}
                filterModels={filterOllamaModels}
                assetModelNeed={assetModelNeed}
                capabilitiesEnabled={capabilitiesEnabled}
                lightSurface={lightSurface}
                onSelect={(model) => {
                  onChange(profile, model)
                  onPick()
                }}
              />
            </div>
          )
        }

        const catalogueModels = PROVIDER_MODELS[profile.provider] ?? []
        const savedDefault = profile.defaultModel
        const rawModels =
          savedDefault && !catalogueModels.includes(savedDefault)
            ? [savedDefault, ...catalogueModels]
            : catalogueModels.length > 0
              ? catalogueModels
              : savedDefault
                ? [savedDefault]
                : []
        const models =
          assetModelNeed === "vision"
            ? rawModels.filter((m) =>
                providerIsMultimodal(profile.provider, m) || modelNameLooksVision(m),
              )
            : rawModels

        return (
          <div key={profile.id}>
            <div
              className={cn(
                "sticky top-0 z-10 flex items-center justify-between border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                lightSurface
                  ? "border-zinc-200 bg-white text-zinc-500"
                  : "border-border/60 bg-card text-muted-foreground",
              )}
            >
              <span>{profile.displayName}</span>
              {profile.isDefault ? (
                <span className="rounded bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                  Default
                </span>
              ) : null}
            </div>
            {models.map((model) => {
              const active =
                selectedProfile?.id === profile.id &&
                (selectedModel === model || (!selectedModel && model === savedDefault))
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => {
                    onChange(profile, model)
                    onPick()
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 border-b px-3 py-2 text-left font-mono text-[12px] last:border-0 transition-colors",
                    lightSurface ? "border-zinc-100" : "border-border/40",
                    active
                      ? lightSurface
                        ? "bg-[#fff4f0] text-[#c2410c]"
                        : "bg-primary/[0.07] text-primary"
                      : lightSurface
                        ? "text-zinc-800 hover:bg-zinc-50"
                        : "text-foreground hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      active
                        ? lightSurface
                          ? "bg-[#ff4f12]"
                          : "bg-primary"
                        : "bg-zinc-300",
                    )}
                  />
                  <span className="flex-1 truncate">{model}</span>
                  <ModelRowTrailingIcons
                    isCloud={false}
                    vision={
                      assetModelNeed === "vision" &&
                      (providerIsMultimodal(profile.provider, model) ||
                        modelNameLooksVision(model))
                    }
                    thinking={false}
                    lightSurface={lightSurface}
                  />
                  {active ? (
                    <span
                      className={cn(
                        "shrink-0 text-[9px] font-semibold uppercase tracking-wide",
                        lightSurface ? "text-[#ff4f12]/80" : "text-primary/60",
                      )}
                    >
                      active
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

export function ChatModelPicker({
  profiles,
  selectedProfile,
  selectedModel,
  onChange,
  ollamaShow,
  ollamaShowLoading,
  filterOllamaModels,
  assetModelNeed,
  compact,
  menuPortal,
  lightSurface = true,
  menuGap = 10,
}: {
  profiles: ChatProfilePicker[]
  selectedProfile: ChatProfilePicker | null
  selectedModel: string
  onChange: (profile: ChatProfilePicker, model: string) => void
  ollamaShow?: OllamaModelShowData
  ollamaShowLoading?: boolean
  /** e.g. vision-only list for image preview */
  filterOllamaModels?: (models: string[]) => string[]
  /** Uses Ollama /api/show capabilities when the menu is open */
  assetModelNeed?: AssetChatModelNeed
  /** Tighter padding for narrow side panels */
  compact?: boolean
  /** Render menu in a portal (avoids overflow clipping in side panels) */
  menuPortal?: boolean
  /** Force light dropdown (PDF preview side panel on dark chrome) */
  lightSurface?: boolean
  /** Px gap between trigger and portaled menu (opens above) */
  menuGap?: number
}) {
  const [open, setOpen] = useState(false)
  const [prefetchCaps, setPrefetchCaps] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  /** Portal avoids clipping in side panels and on mobile composers. */
  const usePortal = menuPortal ?? true

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + menuGap })
  }, [menuGap])

  useEffect(() => {
    if (!open || !usePortal) return
    window.addEventListener("resize", updateMenuPos)
    window.addEventListener("scroll", updateMenuPos, true)
    return () => {
      window.removeEventListener("resize", updateMenuPos)
      window.removeEventListener("scroll", updateMenuPos, true)
    }
  }, [open, updateMenuPos, usePortal])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const displayLabel =
    selectedModel ||
    selectedProfile?.defaultModel ||
    selectedProfile?.displayName ||
    "Pick a model"
  const showOllamaInfo = Boolean(
    selectedProfile &&
      isOllamaProvider(selectedProfile.provider) &&
      (selectedModel || selectedProfile?.defaultModel),
  )
  const enabledProfiles = profiles.filter((p) => p.isEnabled !== false)
  const capabilitiesEnabled = open || prefetchCaps

  const menuPanel = open ? (
    <ScrollFadeList
      maxHeightClass="max-h-80 rounded-xl border"
      className={cn(
        "shadow-sm",
        lightSurface ? LIGHT_MENU : "border-border bg-card shadow-md",
      )}
    >
      <ModelPickerMenu
        enabledProfiles={enabledProfiles}
        selectedProfile={selectedProfile}
        selectedModel={selectedModel}
        onChange={onChange}
        onPick={() => setOpen(false)}
        filterOllamaModels={filterOllamaModels}
        assetModelNeed={assetModelNeed}
        capabilitiesEnabled={capabilitiesEnabled}
        lightSurface={lightSurface}
      />
    </ScrollFadeList>
  ) : null

  const portaledMenu =
    usePortal && open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className={cn("dashboard-main fixed z-[300] w-72", lightSurface && "text-zinc-900")}
            style={{ left: menuPos.left, bottom: menuPos.bottom }}
          >
            {menuPanel}
          </div>,
          document.body,
        )
      : null

  return (
    <div className="relative shrink-0" ref={ref}>
      <div className="flex items-center">
        <button
          ref={triggerRef}
          type="button"
          onMouseEnter={() => setPrefetchCaps(true)}
          onFocus={() => setPrefetchCaps(true)}
          onClick={() => {
            setOpen((v) => {
              const next = !v
              if (next) setPrefetchCaps(true)
              if (next && usePortal) updateMenuPos()
              return next
            })
          }}
          className={cn(
            "flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            compact ? "rounded-l-xl px-2.5 py-2 text-[11px]" : "rounded-l-2xl px-4 py-2.5 text-[12px]",
          )}
        >
          <Sparkles className="size-3.5 text-primary" />
          <span className={cn("truncate font-mono", compact ? "max-w-[9rem]" : "max-w-[160px]")}>
            {displayLabel}
          </span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
        {showOllamaInfo ? (
          <OllamaModelInfoHover
            loading={Boolean(ollamaShowLoading)}
            data={ollamaShow}
            lightSurface={lightSurface}
          />
        ) : null}
      </div>

      {open && !usePortal ? (
        <div ref={menuRef} className="absolute bottom-full left-0 z-50 mb-2 w-72">
          {menuPanel}
        </div>
      ) : null}
      {portaledMenu}
    </div>
  )
}
