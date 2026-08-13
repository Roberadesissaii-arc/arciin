"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BrainCircuit } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { SettingsSegment } from "@/components/settings/settings-segment"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import { getAiSettings, updateAiSettings } from "@/lib/api/settings"
import { getModelProfiles, getOllamaModelShow } from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"
import { isOllamaProvider } from "@/lib/ollama-providers"
import type { AiEmojiUsage, AiSettings } from "@/lib/types/models"

const EMOJI_OPTIONS: { value: AiEmojiUsage; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "No emojis in AI replies" },
  { value: "low", label: "Low", hint: "At most one emoji per message when helpful" },
  { value: "medium", label: "Medium", hint: "Occasional emojis for readability" },
  { value: "high", label: "High", hint: "Emojis allowed freely where they fit" },
]

export function AiPanel() {
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: ({ signal }) => getAiSettings(signal),
  })

  const profilesQuery = useQuery({
    queryKey: queryKeys.modelProfiles,
    queryFn: ({ signal }) => getModelProfiles(signal),
  })

  const defaultProfile =
    profilesQuery.data?.find((p) => p.isDefault) ?? profilesQuery.data?.[0]
  const defaultModelName = defaultProfile?.defaultModel ?? ""
  const defaultIsOllama = Boolean(defaultProfile && isOllamaProvider(String(defaultProfile.provider)))

  const ollamaDefaultShow = useQuery({
    queryKey: queryKeys.ollamaModelShow(defaultProfile?.id ?? "", defaultModelName),
    queryFn: ({ signal }) => getOllamaModelShow(defaultProfile!.id, { model: defaultModelName }, signal),
    enabled: Boolean(defaultProfile?.id && defaultModelName && defaultIsOllama),
    staleTime: 300_000,
  })

  const caps = ollamaDefaultShow.data?.capabilities
  const hideShowThinkingSetting =
    defaultIsOllama &&
    ollamaDefaultShow.isSuccess &&
    Array.isArray(caps) &&
    caps.length > 0 &&
    !caps.some((c) => c.toLowerCase() === "thinking")

  const mutation = useMutation({
    mutationFn: updateAiSettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.aiSettings })
      const prev = queryClient.getQueryData<AiSettings>(queryKeys.aiSettings)
      queryClient.setQueryData<AiSettings>(queryKeys.aiSettings, (old) =>
        old ? { ...old, ...patch } : old,
      )
      return { prev }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.aiSettings, ctx.prev)
      toast.error("Failed to save setting", {
        description: "Your change was reverted. Try again in a moment.",
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiSettings })
    },
  })

  const PLANNING_LABELS: Record<
    keyof Pick<AiSettings, "agent" | "autonomy" | "planning" | "showThinking" | "canvasImages">,
    string
  > = {
    agent: "Agent",
    autonomy: "Autonomy",
    planning: "Planning",
    showThinking: "Show thinking",
    canvasImages: "Canvas illustrations",
  }

  function toggle(
    key: keyof Pick<
      AiSettings,
      "agent" | "autonomy" | "planning" | "showThinking" | "canvasImages"
    >,
  ) {
    if (!data) return
    const enabled = !data[key]
    mutation.mutate(
      { [key]: enabled },
      {
        onSuccess: () => {
          toast.success(`${PLANNING_LABELS[key]} ${enabled ? "enabled" : "disabled"}`, {
            description: "AI planning settings updated for this instance.",
          })
        },
      },
    )
  }

  function setEmojiUsage(emojiUsage: AiEmojiUsage) {
    if (!data || data.emojiUsage === emojiUsage) return
    const label = EMOJI_OPTIONS.find((o) => o.value === emojiUsage)?.label ?? emojiUsage
    mutation.mutate(
      { emojiUsage },
      {
        onSuccess: () => {
          toast.success(`Emoji usage set to ${label}`, {
            description: "This applies to new assistant replies.",
          })
        },
      },
    )
  }

  if (isLoading || profilesQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <SettingsPanelError
        message={error instanceof Error ? error.message : "Could not load AI planning settings."}
        hint="Check that the API is running, then refresh this page."
      />
    )
  }

  const s = data
  const busy = mutation.isPending
  const emojiMeta = EMOJI_OPTIONS.find((o) => o.value === s.emojiUsage) ?? EMOJI_OPTIONS[0]

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={BrainCircuit}
            title="Planning"
            description="Agent behavior, reasoning, and how the AI formats replies"
          />
        </CardHeader>
        <CardContent>
          <SettingRow label="Agent" hint="Enable server tools so the AI can organize and search your library">
            <PillSwitch on={s.agent} onChange={() => toggle("agent")} disabled={busy} />
          </SettingRow>
          <SettingRow
            label="Autonomy"
            hint={
              s.agent
                ? "Run multi-step library actions without asking at each step"
                : "Turn on Agent to use autonomy"
            }
          >
            <PillSwitch
              on={s.autonomy}
              onChange={() => toggle("autonomy")}
              disabled={busy || !s.agent}
            />
          </SettingRow>
          <SettingRow label="Planning" hint="Outline a plan before complex multi-step tasks">
            <PillSwitch on={s.planning} onChange={() => toggle("planning")} disabled={busy} />
          </SettingRow>
          {/* Off by default on purpose: every illustration is a paid generation,
              and a document that did not need one has spent money to become
              slower to read. */}
          <SettingRow
            label="Canvas illustrations"
            hint="Let the assistant add generated pictures inside a Canvas draft where they help. Each picture is a paid image generation."
          >
            <PillSwitch
              on={s.canvasImages}
              onChange={() => toggle("canvasImages")}
              disabled={busy}
            />
          </SettingRow>
          {!hideShowThinkingSetting && (
            <SettingRow
              label="Show Thinking"
              hint="Show the model reasoning trace live above the answer while it streams"
            >
              <PillSwitch on={s.showThinking} onChange={() => toggle("showThinking")} disabled={busy} />
            </SettingRow>
          )}
          {hideShowThinkingSetting && defaultIsOllama && (
            <div className="border-b border-border py-3.5 last:border-0">
              <p className="text-[13px] font-medium text-foreground">Show Thinking</p>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                Hidden for your default Ollama model — it does not report a{" "}
                <span className="font-mono text-[11px]">thinking</span> capability. Pick a
                reasoning-capable model as the profile default to enable this control.
              </p>
            </div>
          )}
          <div className="border-b border-border py-3.5 last:border-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">Emoji usage</p>
                <p className="mt-0.5 text-[12px] text-zinc-500">{emojiMeta.hint}</p>
              </div>
              <SettingsSegment
                aria-label="Emoji usage level"
                options={EMOJI_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                value={s.emojiUsage}
                onChange={setEmojiUsage}
                disabled={busy}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}