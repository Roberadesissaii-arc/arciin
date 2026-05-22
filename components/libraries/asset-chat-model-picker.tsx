"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ChevronDown, Cloud, Loader2, Sparkles } from "lucide-react"

import {
  filterModelsForAssetNeed,
  type AssetChatModelNeed,
} from "@/lib/chat/asset-chat-model"
import { PROVIDER_MODELS } from "@/lib/chat/provider-models"
import { isOllamaProvider } from "@/lib/ollama-providers"
import { useOllamaAvailableModels } from "@/lib/hooks/use-ollama-available-models"
import { cn } from "@/lib/utils"

type ChatProfile = {
  id: string
  displayName: string
  provider: string
  defaultModel: string | null
  isDefault?: boolean
  isEnabled: boolean
}

function OllamaModels({
  profile,
  activeProfileId,
  activeModel,
  need,
  onPick,
}: {
  profile: ChatProfile
  activeProfileId: string | null
  activeModel: string
  need: AssetChatModelNeed
  onPick: (model: string) => void
}) {
  const q = useOllamaAvailableModels(profile.id)
  const raw = q.data?.models ?? (profile.defaultModel ? [profile.defaultModel] : [])
  const models = filterModelsForAssetNeed(raw, need)

  if (q.isPending && models.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-zinc-500">
        <Loader2 className="size-3 animate-spin" />
        Loading models…
      </p>
    )
  }

  if (models.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[11px] text-zinc-500">
        {need === "vision"
          ? "No vision models found. Run ollama pull gemma3 or llava."
          : "No models found for this profile."}
      </p>
    )
  }

  return models.map((model) => {
    const active = activeProfileId === profile.id && activeModel === model
    return (
      <button
        key={model}
        type="button"
        onClick={() => onPick(model)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] transition-colors",
          active
            ? "bg-[#ff4f12]/15 text-[#ffb899]"
            : "text-zinc-300 hover:bg-white/[0.06]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{model}</span>
        {profile.provider === "ollama-cloud" ? (
          <Cloud className="size-3 shrink-0 opacity-50" aria-hidden />
        ) : null}
      </button>
    )
  })
}

export function AssetChatModelPicker({
  profiles,
  profile,
  model,
  modeLabel,
  need,
  onSelect,
  disabled,
}: {
  profiles: ChatProfile[]
  profile: ChatProfile | null
  model: string
  modeLabel: string
  need: AssetChatModelNeed
  onSelect: (profile: ChatProfile, model: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const label = model || profile?.defaultModel || "Model"

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        disabled={disabled || profiles.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex max-w-[11rem] items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Model · ${modeLabel}`}
      >
        <Sparkles className="size-3 shrink-0 text-[#ff4f12]" />
        <span className="truncate font-mono">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div
          className="absolute bottom-full left-0 z-50 mb-1.5 w-64 overflow-hidden rounded-xl border border-white/12 bg-[#1c1c20] shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
          role="listbox"
        >
          <div className="border-b border-white/8 px-3 py-2 text-[10px] text-zinc-500">
            {need === "vision" ? (
              <>
                <span className="text-zinc-400">Vision models</span>
                <span className="text-zinc-600"> · images</span>
              </>
            ) : (
              <>
                Mode: <span className="text-zinc-400">{modeLabel}</span>
              </>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto scrollbar-hide">
            {profiles.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-zinc-500">
                <Link href="/models" className="text-[#ff8a5c] hover:underline">
                  Connect a model
                </Link>
              </p>
            ) : (
              profiles
                .filter((p) => p.isEnabled)
                .map((p) => (
                  <div key={p.id} className="border-b border-white/6 last:border-0">
                    <p className="sticky top-0 bg-[#1c1c20] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                      {p.displayName}
                    </p>
                    {isOllamaProvider(p.provider) ? (
                      <OllamaModels
                        profile={p}
                        activeProfileId={profile?.id ?? null}
                        activeModel={model}
                        need={need}
                        onPick={(m) => {
                          onSelect(p, m)
                          setOpen(false)
                        }}
                      />
                    ) : (
                      (() => {
                        const catalogue = PROVIDER_MODELS[p.provider] ?? []
                        const saved = p.defaultModel
                        const models =
                          saved && !catalogue.includes(saved)
                            ? [saved, ...catalogue]
                            : catalogue.length > 0
                              ? catalogue
                              : saved
                                ? [saved]
                                : []
                        return models.map((m) => {
                          const active = profile?.id === p.id && model === m
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                onSelect(p, m)
                                setOpen(false)
                              }}
                              className={cn(
                                "flex w-full px-3 py-2 text-left font-mono text-[11px]",
                                active
                                  ? "bg-[#ff4f12]/15 text-[#ffb899]"
                                  : "text-zinc-300 hover:bg-white/[0.06]",
                              )}
                            >
                              <span className="truncate">{m}</span>
                            </button>
                          )
                        })
                      })()
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
