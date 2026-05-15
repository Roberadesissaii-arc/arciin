"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, Lock, ShieldAlert, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { getAiSecuritySettings, updateAiSecuritySettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { AiSecuritySettings } from "@/lib/types/models"

const SETTING_LABELS: Record<keyof AiSecuritySettings, string> = {
  blockInjection: "Prompt injection filter",
  redactSecrets: "Redact secrets",
  redactPII: "Redact PII",
  readOnlyTools: "Read-only library tools",
  requireToolApproval: "Require explicit approval",
  hideLibraryNames: "Hide library names",
  hideAssetCounts: "Hide asset counts",
  hideStorageSize: "Hide storage usage",
  hideUploadDates: "Hide last upload time",
}

const DEFAULTS: AiSecuritySettings = {
  blockInjection: true,
  redactSecrets: true,
  redactPII: true,
  readOnlyTools: false,
  requireToolApproval: false,
  hideLibraryNames: false,
  hideAssetCounts: false,
  hideStorageSize: false,
  hideUploadDates: false,
}


function SecurityCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <SectionHeader icon={icon} title={title} description={description} />
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function AiSecurityPanel() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.aiSecuritySettings,
    queryFn: ({ signal }) => getAiSecuritySettings(signal),
  })

  const mutation = useMutation({
    mutationFn: updateAiSecuritySettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.aiSecuritySettings })
      const prev = queryClient.getQueryData<AiSecuritySettings>(queryKeys.aiSecuritySettings)
      queryClient.setQueryData<AiSecuritySettings>(queryKeys.aiSecuritySettings, (old) =>
        old ? { ...old, ...patch } : old,
      )
      return { prev }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.aiSecuritySettings, ctx.prev)
      toast.error("Failed to save setting")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiSecuritySettings })
    },
  })

  function toggle(key: keyof AiSecuritySettings) {
    if (!data) return
    const enabled = !data[key]
    mutation.mutate(
      { [key]: enabled },
      {
        onSuccess: () => {
          toast.success(`${SETTING_LABELS[key]} ${enabled ? "enabled" : "disabled"}`)
        },
      },
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
    )
  }

  const s = data ?? DEFAULTS
  const busy = mutation.isPending

  return (
    <div className="space-y-4">
      <SecurityCard
        icon={ShieldAlert}
        title="Protection"
        description="Sanitize prompts before they are sent to AI providers"
      >
        <SettingRow
          label="Prompt injection filter"
          hint="Neutralize common jailbreak phrases in user messages"
        >
          <PillSwitch on={s.blockInjection} onChange={() => toggle("blockInjection")} disabled={busy} />
        </SettingRow>
        <SettingRow
          label="Redact secrets"
          hint="Strip API keys, tokens, and bearer strings from outbound chat text"
        >
          <PillSwitch on={s.redactSecrets} onChange={() => toggle("redactSecrets")} disabled={busy} />
        </SettingRow>
        <SettingRow
          label="Redact PII"
          hint="Mask emails, phone numbers, and SSN-like patterns in outbound chat text"
        >
          <PillSwitch on={s.redactPII} onChange={() => toggle("redactPII")} disabled={busy} />
        </SettingRow>
      </SecurityCard>

      <SecurityCard
        icon={SlidersHorizontal}
        title="Control"
        description="Limit what the Arciin agent can do on your libraries"
      >
        <SettingRow
          label="Read-only library tools"
          hint="Allow vision search only — block organize and folder moves"
        >
          <PillSwitch on={s.readOnlyTools} onChange={() => toggle("readOnlyTools")} disabled={busy} />
        </SettingRow>
        <SettingRow
          label="Require explicit approval"
          hint="Disable automatic organize/search actions until the user clearly asks"
        >
          <PillSwitch
            on={s.requireToolApproval}
            onChange={() => toggle("requireToolApproval")}
            disabled={busy}
          />
        </SettingRow>
      </SecurityCard>

      <SecurityCard
        icon={Eye}
        title="Privacy"
        description="Control what instance metadata is included in chat context for AI providers"
      >
        <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-sky-950">
          These settings apply to the instance context block injected into chat. Your full data stays on
          your server; providers only see what you allow here.
        </div>
        <SettingRow
          label="Hide library names"
          hint='Use generic labels such as "Library 1" instead of real library names'
        >
          <PillSwitch on={s.hideLibraryNames} onChange={() => toggle("hideLibraryNames")} disabled={busy} />
        </SettingRow>
        <SettingRow label="Hide asset counts" hint="Omit per-library and per-type file counts from context">
          <PillSwitch on={s.hideAssetCounts} onChange={() => toggle("hideAssetCounts")} disabled={busy} />
        </SettingRow>
        <SettingRow label="Hide storage usage" hint="Do not share total storage used with AI providers">
          <PillSwitch on={s.hideStorageSize} onChange={() => toggle("hideStorageSize")} disabled={busy} />
        </SettingRow>
        <SettingRow label="Hide last upload time" hint="Exclude the most recent upload timestamp from context">
          <PillSwitch on={s.hideUploadDates} onChange={() => toggle("hideUploadDates")} disabled={busy} />
        </SettingRow>
      </SecurityCard>

      <p className="flex items-start gap-2 px-1 text-[12px] text-zinc-500">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        Chat conversations are stored on your instance for history and audit. Provider API keys never
        leave the server in chat prompts.
      </p>
    </div>
  )
}