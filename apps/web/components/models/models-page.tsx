"use client"

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Star,
  Unplug,
  X,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { useLicense } from "@/lib/license/use-license"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { PlanBadge } from "@/components/license/plan-badge"
import { ModelTestPanel, ModelTestTrigger } from "@/components/models/model-test-box"
import {
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_TTS_MODEL,
  GEMINI_CHAT_MODELS,
  GEMINI_OTHER_MODELS,
  GEMINI_TTS_MODELS,
  type GeminiModelEntry,
} from "@arciin/shared"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"
import {
  createModelProfile,
  deleteModelProfile,
  getModelProfiles,
  getOllamaCloudModels,
  setDefaultModelProfile,
  updateModelProfile,
} from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"
import type { CreateModelProfileInput, ModelProfile, OllamaCloudModelProbe } from "@/lib/types/models"

// ── Provider catalogue ─────────────────────────────────────────────────────────

type ProviderMeta = {
  id: string
  name: string
  logo: string
  logoInvert?: boolean
  logoBg?: string
  description: string
  requiresKey: boolean
  requiresBaseUrl: boolean
  baseUrlPlaceholder?: string
  suggestedModels: string[]
  docsUrl: string
  badge?: string
}

/** Representative ollama.com cloud models (see https://docs.ollama.com/cloud). Live list comes from /api/tags after connect. */
const OLLAMA_CLOUD_SUGGESTED_MODELS = [
  "gpt-oss:120b",
  "deepseek-v4-flash",
  "qwen3.5",
  "gemma4:31b",
  "kimi-k2.6",
  "minimax-m3",
]

/** Free plan: Ollama Local + Ollama Cloud only (BYOK). Other providers need Pro multi-provider. */
const FREE_PROVIDER_IDS = new Set(["ollama-local", "ollama-cloud"])

const PROVIDERS: ProviderMeta[] = [
  {
    id: "openai",
    name: "OpenAI",
    logo: "/assets/icons/models/openai-light.svg",
    logoInvert: true,
    description:
      "GPT-4o, o1, and the full OpenAI model family via the official API. Add your platform key to run chat on your instance.",
    requiresKey: true,
    requiresBaseUrl: false,
    suggestedModels: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "gpt-4-turbo"],
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    logo: "/assets/icons/models/anthropic.svg",
    description:
      "Claude Opus 4, Sonnet 4, and Haiku via the Anthropic API. Connect with your console key for long-context chat.",
    requiresKey: true,
    requiresBaseUrl: false,
    suggestedModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    logo: "/assets/icons/models/gemini-color.svg",
    description:
      "One Google AI Studio API key powers chat and Read aloud. Pick chat and speech models below.",
    requiresKey: true,
    requiresBaseUrl: false,
    suggestedModels: GEMINI_CHAT_MODELS.map((m) => m.id),
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: "/assets/icons/models/deepseek-color.svg",
    description: "DeepSeek V4 Flash and Pro — high-capability open models at low cost, OpenAI-compatible API.",
    requiresKey: true,
    requiresBaseUrl: false,
    baseUrlPlaceholder: "https://api.deepseek.com/v1",
    suggestedModels: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    logo: "/assets/icons/models/grok.svg",
    logoBg: "#ffffff",
    description:
      "Grok-2 and Grok-3 from xAI, via the xAI API. Connect with your xAI key to run Grok models through Arciin chat.",
    requiresKey: true,
    requiresBaseUrl: false,
    suggestedModels: ["grok-2", "grok-2-mini", "grok-3"],
    docsUrl: "https://console.x.ai/",
  },
  {
    id: "meta",
    name: "Meta (Llama)",
    logo: "/assets/icons/models/meta-color.svg",
    description:
      "Llama 3 and Llama 4 via Together AI, Fireworks, or any OpenAI-compatible endpoint. Point at your host URL and model id.",
    requiresKey: true,
    requiresBaseUrl: true,
    baseUrlPlaceholder: "https://api.together.xyz/v1",
    suggestedModels: ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "meta-llama/Llama-4-Scout-17B-16E-Instruct"],
    docsUrl: "https://api.together.ai/",
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba)",
    logo: "/assets/icons/models/qwen-color.svg",
    description:
      "Qwen-Turbo, Qwen-Plus, and Qwen-Max from Alibaba Cloud. OpenAI-compatible API — use your DashScope or international key.",
    requiresKey: true,
    requiresBaseUrl: false,
    baseUrlPlaceholder: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    suggestedModels: ["qwen-max", "qwen-plus", "qwen-turbo"],
    docsUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "ollama-local",
    name: "Ollama Local",
    logo: "/assets/icons/models/ollama-dark.svg",
    logoInvert: true,
    description: "Run open models on your own machine. No API key needed — models are detected live from your running Ollama instance.",
    requiresKey: false,
    requiresBaseUrl: true,
    baseUrlPlaceholder: "http://localhost:11434",
    suggestedModels: ["llama3.2", "mistral", "qwen2.5", "phi4", "gemma3"],
    docsUrl: "https://ollama.com/",
    badge: "Local",
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    logo: "/assets/models/ollama.svg",
    logoBg: "#ffffff",
    description: "Run cloud-hosted models on ollama.com — no local GPU required. Models are fetched live from your account.",
    requiresKey: true,
    requiresBaseUrl: false,
    suggestedModels: OLLAMA_CLOUD_SUGGESTED_MODELS,
    docsUrl: "https://ollama.com/settings/api-keys",
    badge: "Cloud",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    logo: "/assets/icons/models/elevenlabs.svg",
    description:
      "Text-to-speech and voice cloning for audio content and narration. Connect for speech synthesis and future audio workflows.",
    requiresKey: true,
    requiresBaseUrl: false,
    suggestedModels: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    badge: "Audio",
  },
]

// ── Provider card ──────────────────────────────────────────────────────────────

function ModelChip({ name }: { name: string }) {
  return (
    <span
      className="max-w-[9.5rem] shrink-0 truncate rounded-lg border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
      title={name}
    >
      {name}
    </span>
  )
}

function ProviderCard({
  meta,
  profile,
  locked,
  lockPlanLabel,
  onConnect,
  onEdit,
  onSetDefault,
  onDisconnect,
}: {
  meta: ProviderMeta
  profile: ModelProfile | undefined
  locked?: boolean
  lockPlanLabel?: string
  onConnect: () => void
  onEdit: () => void
  onSetDefault: () => void
  onDisconnect: () => void
}) {
  const connected = Boolean(profile?.isEnabled && (profile.hasApiKey || !meta.requiresKey))
  const modelPreview = meta.suggestedModels.slice(0, 3)
  const extraModelCount = Math.max(0, meta.suggestedModels.length - 3)
  const testable = connected && !locked && Boolean(profile) && FREE_PROVIDER_IDS.has(meta.id)
  const [testOpen, setTestOpen] = useState(false)

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md",
        locked && "opacity-95",
      )}
      style={
        connected && !locked
          ? {
              borderColor: "color-mix(in srgb, var(--arciin-accent, #ff4f12) 25%, transparent)",
              background: "color-mix(in srgb, var(--arciin-accent, #ff4f12) 2%, transparent)",
            }
          : undefined
      }
    >
      {/* Top */}
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border"
            style={meta.logoBg
              ? { background: meta.logoBg, borderColor: "var(--border)" }
              : meta.logoInvert
                ? { background: "#18181b", borderColor: "#3f3f46" }
                : { background: "var(--muted)", borderColor: "var(--border)" }
            }
          >
            <Image
              src={meta.logo}
              alt={meta.name}
              width={24}
              height={24}
              className="size-6 object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-foreground">{meta.name}</p>
              {meta.badge && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {meta.badge}
                </span>
              )}
              {profile?.isDefault && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                  Default
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: connected ? "#22c55e" : "#d4d4d8", boxShadow: connected ? "0 0 5px #22c55e80" : undefined }}
              />
              <p className="text-[11px] text-zinc-500">{connected ? (profile?.defaultModel ?? "Connected") : "Not connected"}</p>
            </div>
          </div>
        </div>
        {connected && (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        )}
      </div>

      {/* Description — equal visual block across cards (matches Ollama / DeepSeek length) */}
      <p className="min-h-[2.875rem] px-4 text-[12px] leading-relaxed text-zinc-500 line-clamp-3">
        {meta.description}
      </p>

      {meta.suggestedModels.length > 0 ? (
        <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-hidden px-4 pb-4">
          {modelPreview.map((m) => (
            <ModelChip key={m} name={m} />
          ))}
          {extraModelCount > 0 ? (
            <span className="shrink-0 rounded-lg border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              +{extraModelCount} more
            </span>
          ) : null}
        </div>
      ) : (
        <div className="pb-4" aria-hidden />
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {locked ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-700">
              <Lock className="size-3.5 text-zinc-500" strokeWidth={1.75} />
              Free includes Ollama only
              <PlanBadge plan={lockPlanLabel ?? "Pro"} />
            </span>
            <Button
              size="sm"
              className="ml-auto h-7 bg-[color:var(--arciin-accent,#FF4F12)] px-2.5 text-[12px] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90"
              asChild
            >
              <Link href="/settings?tab=license">Unlock {lockPlanLabel ?? "Pro"}</Link>
            </Button>
          </>
        ) : connected ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-border px-2.5 text-[12px] text-foreground hover:bg-muted/60"
              onClick={onEdit}
            >
              <Settings2 className="size-3" />
              Configure
            </Button>
            {!profile?.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2.5 text-[12px] text-zinc-500 hover:text-foreground"
                onClick={onSetDefault}
              >
                <Star className="size-3" />
                Set default
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {testable ? (
                <ModelTestTrigger open={testOpen} onToggle={() => setTestOpen((v) => !v)} />
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-zinc-400 hover:text-red-500"
                onClick={onDisconnect}
              >
                <Unplug className="size-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="sm"
            className="h-7 gap-1.5 bg-primary px-3 text-[12px] text-white hover:bg-primary/90"
            onClick={onConnect}
          >
            <Plus className="size-3" />
            Connect
          </Button>
        )}
      </div>

      {/* Free-tier connection test — Ollama only, available on every plan (core.basic_ai) */}
      {testable && testOpen && profile ? (
        <ModelTestPanel profileId={profile.id} onClose={() => setTestOpen(false)} />
      ) : null}
    </div>
  )
}

// ── Connect / Edit sheet ───────────────────────────────────────────────────────

function GeminiModelSelect({
  id,
  label,
  hint,
  value,
  onChange,
  models,
  placeholder,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  models: GeminiModelEntry[]
  placeholder: string
}) {
  const [open, setOpen] = useState(false)

  const picker = (
    <>
      {hint ? <p className="mb-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="pr-8 font-mono text-[13px]"
          autoComplete="off"
        />
        <button
          type="button"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => {
            e.preventDefault()
            setOpen((v) => !v)
          }}
        >
          <ChevronDown className="size-3.5" />
        </button>
        {open ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-md">
            {models.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted/60"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(entry.id)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 font-mono text-[12px] text-foreground">{entry.id}</span>
                {entry.badge ? (
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                    {entry.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )

  if (!label) return picker

  return (
    <Field>
      <FieldLabel htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </FieldLabel>
      {picker}
    </Field>
  )
}

function ConnectSheet({
  meta,
  profile,
  open,
  onOpenChange,
  onSaved,
}: {
  meta: ProviderMeta
  profile: ModelProfile | undefined
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const isEdit = Boolean(profile)
  const isOllamaLocal = meta.id === "ollama-local"
  const isOllamaCloud = meta.id === "ollama-cloud"
  const isAnyOllama = isOllamaLocal || isOllamaCloud
  const isGemini = meta.id === "gemini"

  const [scannedModels, setScannedModels] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [cloudProbes, setCloudProbes] = useState<OllamaCloudModelProbe[]>([])

  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(() => {
    if (profile?.baseUrl) return profile.baseUrl
    if (isOllamaLocal) return "http://localhost:11434"
    return meta.baseUrlPlaceholder ?? ""
  })
  const [model, setModel] = useState(() => {
    if (profile?.defaultModel) return profile.defaultModel
    if (isAnyOllama) return ""
    if (isGemini) return DEFAULT_GEMINI_CHAT_MODEL
    return meta.suggestedModels[0] ?? ""
  })
  const [ttsModel, setTtsModel] = useState(() => {
    if (profile?.ttsModel) return profile.ttsModel
    if (isGemini) return DEFAULT_GEMINI_TTS_MODEL
    return ""
  })
  const [showSuggestions, setShowSuggestions] = useState(false)

  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (input: CreateModelProfileInput) => createModelProfile(input),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelProfiles })
      if (isOllamaCloud) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.availableModels(created.id) })
      }
      toast.success(`${meta.name} connected.`, {
        description: "This provider is now available for chat and automation.",
      })
      onSaved()
    },
    onError: (err) =>
      toast.error("Failed to save", {
        description: err instanceof Error ? err.message : "Check your key and try again.",
      }),
  })

  const updateMutation = useMutation({
    mutationFn: (input: Partial<CreateModelProfileInput>) => updateModelProfile(profile!.id, input),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelProfiles })
      if (isOllamaCloud) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.availableModels(updated.id) })
      }
      toast.success(`${meta.name} updated.`, {
        description: "Your provider settings are saved.",
      })
      onSaved()
    },
    onError: (err) =>
      toast.error("Failed to save", {
        description: err instanceof Error ? err.message : "Check your key and try again.",
      }),
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  async function scanCloudModels(refresh = false) {
    if (!profile?.id) {
      setScanError("Save your API key first, then test models.")
      return
    }
    setScanning(true)
    setScanError(null)
    try {
      const { probes } = await getOllamaCloudModels(profile.id, { refresh })
      setCloudProbes(probes)
      const available = probes.filter((p) => p.access === "available")
      if (available.length > 0 && !model) setModel(available[0]!.name)
      if (available.length === 0) {
        setScanError("No models responded with your key. Paid models need a paid API key; free models may be rate-limited.")
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Could not test cloud models")
      setCloudProbes([])
    } finally {
      setScanning(false)
    }
  }

  function handleSheetOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (nextOpen && isOllamaCloud && isEdit && profile?.hasApiKey) {
      void scanCloudModels(false)
    }
  }

  async function scanLocalModels() {
    setScanning(true)
    setScanError(null)
    try {
      const base = (baseUrl || "http://localhost:11434").replace(/\/$/, "")
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
      const data = await res.json() as { models?: { name: string }[] }
      const names = (data.models ?? []).map((m) => m.name).filter(Boolean)
      setScannedModels(names)
      if (names.length > 0 && !model) setModel(names[0])
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Could not connect to Ollama")
    } finally {
      setScanning(false)
    }
  }

  function handleSave() {
    const resolvedBaseUrl = isOllamaLocal
      ? (baseUrl || "http://localhost:11434")
      : isOllamaCloud
        ? "https://ollama.com"
        : (baseUrl || null)
    const input: CreateModelProfileInput = {
      provider: meta.id,
      displayName: isEdit ? (profile?.displayName ?? meta.name) : meta.name,
      defaultModel: model || null,
      baseUrl: resolvedBaseUrl,
      isEnabled: true,
    }
    if (isGemini) input.ttsModel = ttsModel.trim() || DEFAULT_GEMINI_TTS_MODEL
    if (apiKey) input.apiKey = apiKey
    if (isEdit) updateMutation.mutate(input)
    else createMutation.mutate(input)
  }

  const saveDisabled = isPending
    || (isOllamaCloud && !isEdit && !apiKey)
    || (!isAnyOllama && meta.requiresKey && !isEdit && !apiKey)
    || (!isAnyOllama && meta.requiresBaseUrl && !baseUrl)

  const headerDescription = isOllamaLocal
    ? "Point to your local Ollama instance — models are detected automatically."
    : isOllamaCloud
      ? "Add your API key to access cloud-hosted models on ollama.com."
      : meta.requiresKey
        ? "Enter your API credentials."
        : "Configure the endpoint."

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
      >
        {/* Header */}
        <SheetHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-12">
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border"
              style={meta.logoBg
                ? { background: meta.logoBg, borderColor: "var(--border)" }
                : meta.logoInvert
                  ? { background: "#18181b", borderColor: "#3f3f46" }
                  : { background: "var(--muted)", borderColor: "var(--border)" }
              }
            >
              <Image src={meta.logo} alt={meta.name} width={22} height={22} className="size-[22px] object-contain" />
            </div>
            <div>
              <SheetTitle className="text-[15px] font-semibold text-foreground">
                {isEdit ? `Configure ${meta.name}` : `Connect ${meta.name}`}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-[12px] text-muted-foreground">
                {headerDescription}{" "}
                <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline">
                  Docs
                </a>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">

          {/* ── Ollama Local form ── */}
          {isOllamaLocal && (
            <>
              <Field>
                <FieldLabel htmlFor="ollama-url" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ollama URL
                </FieldLabel>
                <Input
                  id="ollama-url"
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setScannedModels([]) }}
                  placeholder="http://localhost:11434"
                  className="font-mono text-[13px]"
                />
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Default model{" "}
                    <span className="ml-1 font-normal normal-case text-muted-foreground/70">(optional)</span>
                  </FieldLabel>
                  <button
                    type="button"
                    onClick={scanLocalModels}
                    disabled={scanning}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {scanning ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    {scanning ? "Scanning…" : "Scan installed"}
                  </button>
                </div>

                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="llama3.2  (leave blank to auto-detect)"
                  className="font-mono text-[13px]"
                />

                {scanError && (
                  <p className="text-[11px] text-red-500">{scanError} — is Ollama running?</p>
                )}

                {scannedModels.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {scannedModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModel(m)}
                        className={cn(
                          "flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left font-mono text-[12px] last:border-0 transition-colors",
                          model === m ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
                        )}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", model === m ? "bg-primary" : "bg-zinc-300")} />
                        {m}
                        {model === m && <Check className="ml-auto size-3 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}

                {scannedModels.length === 0 && !scanError && !scanning && (
                  <p className="text-[11px] text-muted-foreground">
                    The Chat picker fetches your installed models live. Scan now to set a default, or leave blank.
                  </p>
                )}
              </Field>
            </>
          )}

          {/* ── Ollama Cloud form ── */}
          {isOllamaCloud && (
            <>
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3.5 py-3">
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Cloud models run on ollama.com — no local GPU needed. Get your API key at{" "}
                  <a href="https://ollama.com/settings/api-keys" target="_blank" rel="noopener noreferrer"
                    className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
                    ollama.com/settings/api-keys
                  </a>
                </p>
              </div>

              <Field>
                <FieldLabel htmlFor="cloud-api-key" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ollama API key{isEdit && profile?.hasApiKey && (
                    <span className="ml-1 font-normal normal-case text-muted-foreground/70">(leave blank to keep current)</span>
                  )}
                </FieldLabel>
                <Input
                  id="cloud-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={isEdit && profile?.hasApiKey ? profile.apiKeyMasked ?? "••••••••" : "ollama_…"}
                  className="font-mono text-[13px]"
                />
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Cloud models
                  </FieldLabel>
                  {isEdit && profile?.hasApiKey && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 px-2 text-[11px]"
                      disabled={scanning}
                      onClick={() => void scanCloudModels(true)}
                    >
                      {scanning ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                      Test models
                    </Button>
                  )}
                </div>
                {!isEdit && (
                  <p className="text-[11px] text-muted-foreground">
                    Save your key first. Chat will test each ollama.com model and only list ones that work.
                  </p>
                )}
                {scanError && (
                  <p className="text-[11px] text-amber-700">{scanError}</p>
                )}
                {cloudProbes.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/50">
                    {cloudProbes.map((probe) => {
                      const active = model === probe.name
                      const canSelect = probe.access === "available"
                      return (
                        <button
                          key={probe.name}
                          type="button"
                          disabled={!canSelect}
                          onClick={() => canSelect && setModel(probe.name)}
                          className={cn(
                            "flex w-full items-center gap-2 border-b border-border/50 px-3 py-2.5 text-left font-mono text-[12px] last:border-0",
                            active && canSelect && "bg-primary/[0.08] text-primary",
                            canSelect && !active && "text-foreground hover:bg-muted/40",
                            !canSelect && "cursor-not-allowed text-muted-foreground/60",
                          )}
                        >
                          <span className="flex-1 truncate">{probe.name}</span>
                          <Cloud className="size-3.5 shrink-0 opacity-50" aria-hidden />
                          {probe.access === "available" && active && (
                            <Check className="size-3 shrink-0 text-primary" />
                          )}
                          {probe.access === "paid" && (
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-amber-600">Paid</span>
                          )}
                          {probe.access === "rate_limited" && (
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-sky-600">Wait</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                {isEdit && profile?.hasApiKey && cloudProbes.length === 0 && !scanning && !scanError && (
                  <p className="text-[11px] text-muted-foreground">
                    Press Test models to refresh. The first full check is saved for 7 days.
                  </p>
                )}
              </Field>
            </>
          )}

          {/* ── Generic provider form ── */}
          {!isAnyOllama && (
            <>
              {meta.requiresKey && (
                <Field>
                  <FieldLabel htmlFor="api-key" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    API key{isEdit && profile?.hasApiKey && (
                      <span className="ml-1 font-normal normal-case text-muted-foreground/70">(leave blank to keep current)</span>
                    )}
                  </FieldLabel>
                  <Input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isEdit && profile?.hasApiKey ? profile.apiKeyMasked ?? "••••••••••••" : "sk-..."}
                    className="font-mono text-[13px]"
                  />
                </Field>
              )}

              {(meta.requiresBaseUrl || meta.baseUrlPlaceholder) && (
                <Field>
                  <FieldLabel htmlFor="base-url" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Base URL{!meta.requiresBaseUrl && (
                      <span className="ml-1 font-normal normal-case text-muted-foreground/70">(optional)</span>
                    )}
                  </FieldLabel>
                  <Input
                    id="base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={meta.baseUrlPlaceholder ?? "https://api.example.com/v1"}
                    className="font-mono text-[13px]"
                  />
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="default-model" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isGemini ? "Chat model" : "Default model"}
                </FieldLabel>
                {isGemini ? (
                  <GeminiModelSelect
                    id="default-model"
                    label=""
                    value={model}
                    onChange={setModel}
                    models={[...GEMINI_CHAT_MODELS, ...GEMINI_OTHER_MODELS]}
                    placeholder={DEFAULT_GEMINI_CHAT_MODEL}
                  />
                ) : (
                <div className="relative">
                  <Input
                    id="default-model"
                    value={model}
                    onChange={(e) => { setModel(e.target.value); setShowSuggestions(true) }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder={meta.suggestedModels[0] ?? "model-name"}
                    className="pr-8 font-mono text-[13px]"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onMouseDown={(e) => { e.preventDefault(); setShowSuggestions((v) => !v) }}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  {showSuggestions && (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-md">
                      {meta.suggestedModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="flex w-full items-center border-b border-border px-3 py-2.5 font-mono text-[12px] text-foreground last:border-0 hover:bg-muted/60"
                          onMouseDown={(e) => { e.preventDefault(); setModel(m); setShowSuggestions(false) }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                )}
              </Field>

              {isGemini ? (
                <>
                  <GeminiModelSelect
                    id="tts-model"
                    label="Read aloud model"
                    hint="Uses the same API key as chat. Powers Listen on assistant messages."
                    value={ttsModel}
                    onChange={setTtsModel}
                    models={GEMINI_TTS_MODELS}
                    placeholder={DEFAULT_GEMINI_TTS_MODEL}
                  />
                </>
              ) : null}
            </>
          )}

          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              API keys are stored on this instance only and never sent to external servers. Keys are masked in the UI after saving.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-5 py-4">
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-primary text-white hover:bg-primary/90"
              disabled={saveDisabled}
              onClick={handleSave}
            >
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Connect"}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Main page component ────────────────────────────────────────────────────────

export function ModelsPage() {
  const queryClient = useQueryClient()
  const license = useLicense()
  const [sheetMeta, setSheetMeta] = useState<ProviderMeta | null>(null)

  const multiProvider = license.hasFeature("ai.multi_provider")
  const multiPlanLabel = license.planLabel(license.requiredPlanFor("ai.multi_provider") ?? "pro")

  const profilesQuery = useQuery({
    queryKey: queryKeys.modelProfiles,
    queryFn: ({ signal }) => getModelProfiles(signal),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteModelProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelProfiles })
      toast.success("Provider disconnected.", {
        description: "Its API key was removed from this instance.",
      })
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: setDefaultModelProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelProfiles })
      toast.success("Default model updated.", {
        description: "New chats will use this provider unless you pick another.",
      })
    },
  })

  const profiles = profilesQuery.data ?? []
  const connected = profiles.filter((p) => p.isEnabled)
  const defaultProfile = profiles.find((p) => p.isDefault)

  function profileFor(providerId: string) {
    return profiles.find((p) => p.provider === providerId)
  }

  function isProviderLocked(providerId: string) {
    if (multiProvider) return false
    // Free / basic BYOK: Ollama Local + Ollama Cloud only
    return !FREE_PROVIDER_IDS.has(providerId)
  }

  const sheetProfile = sheetMeta ? profileFor(sheetMeta.id) : undefined

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <DashboardPageIntro
        title="Models"
        subtitle="Bring your own inference"
        cornerDecoration={<IntroCornerIcon icon={Sparkles} />}
        description={
          multiProvider
            ? "Connect AI providers by adding your API keys. Keys are stored on this instance only. Arciin uses these profiles for AI Chat and future automations."
            : "Free lets you connect and test one Ollama Local or Ollama Cloud model. Full AI Chat, Ask AI on files, and multiple providers require Pro."
        }
        stats={[
          { label: "Connected",  value: String(connected.length) },
          { label: "Default",    value: defaultProfile?.displayName ?? "None" },
          { label: "Providers",  value: multiProvider ? String(PROVIDERS.length) : "2 free" },
          { label: "Storage",    value: "On-instance" },
        ]}
      />

      {!multiProvider ? (
        <div className="rounded-2xl border border-border bg-card/80 px-4 py-3 text-[13px] leading-relaxed text-zinc-700">
          <span className="font-bold text-[color:var(--arciin-accent,#FF4F12)]">Free plan: </span>
          You can connect and test one <span className="font-medium">Ollama Local</span> or{" "}
          <span className="font-medium">Ollama Cloud</span> model on Free. Full AI Chat, Ask AI on
          files, PDF Q&amp;A, image understanding, smart classification, and multiple provider
          profiles are available on{" "}
          <Link
            href="/settings?tab=license"
            className="font-semibold text-[color:var(--arciin-accent,#FF4F12)] underline decoration-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_40%,transparent)] underline-offset-2 hover:decoration-[color:var(--arciin-accent,#FF4F12)]"
          >
            {multiPlanLabel}
          </Link>
          .
        </div>
      ) : null}

      {/* Provider grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map((meta) => {
          const profile = profileFor(meta.id)
          const locked = isProviderLocked(meta.id)
          return (
            <ProviderCard
              key={meta.id}
              meta={meta}
              profile={profile}
              locked={locked}
              lockPlanLabel={multiPlanLabel}
              onConnect={() => {
                if (locked) return
                setSheetMeta(meta)
              }}
              onEdit={() => {
                if (locked) return
                setSheetMeta(meta)
              }}
              onSetDefault={() => profile && setDefaultMutation.mutate(profile.id)}
              onDisconnect={() => profile && deleteMutation.mutate(profile.id)}
            />
          )
        })}
      </div>

      {/* Connect sheet */}
      {sheetMeta && (
        <ConnectSheet
          meta={sheetMeta}
          profile={sheetProfile}
          open={Boolean(sheetMeta)}
          onOpenChange={(v) => { if (!v) setSheetMeta(null) }}
          onSaved={() => setSheetMeta(null)}
        />
      )}
    </div>
  )
}
