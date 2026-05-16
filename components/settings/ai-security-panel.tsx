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
import { SettingsSegment } from "@/components/settings/settings-segment"
import {
  VAULT_AI_ENCRYPTED,
  type AiLibraryToolAccess,
  type PasswordVaultAiAccessLevel,
} from "@arciin/shared"

import { getAiSecuritySettings, updateAiSecuritySettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { AiSecuritySettings } from "@/lib/types/models"

const SETTING_LABELS: Record<
  Exclude<
    keyof AiSecuritySettings,
    | "libraryToolAccess"
    | "readOnlyTools"
    | "passwordVaultAiAccess"
    | "passwordVaultAiShare"
    | "passwordQueriesLocalAiOnly"
  >,
  string
> = {
  blockInjection: "Prompt injection filter",
  redactSecrets: "Redact secrets",
  redactPII: "Redact PII",
  requireToolApproval: "Require explicit approval",
  hideLibraryNames: "Hide library names",
  hideAssetCounts: "Hide asset counts",
  hideStorageSize: "Hide storage usage",
  hideUploadDates: "Hide last upload time",
}

const LIBRARY_TOOL_ACCESS_OPTIONS: { value: AiLibraryToolAccess; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "sandbox", label: "Sandbox" },
  { value: "vision_only", label: "Read-only" },
]

const DEFAULTS: AiSecuritySettings = {
  blockInjection: true,
  redactSecrets: true,
  redactPII: true,
  readOnlyTools: false,
  libraryToolAccess: "full",
  requireToolApproval: false,
  hideLibraryNames: false,
  hideAssetCounts: false,
  hideStorageSize: false,
  hideUploadDates: false,
  passwordVaultAiAccess: "blocked",
  passwordVaultAiShare: {
    names: true,
    usernames: true,
    urls: true,
    notes: false,
  },
  passwordQueriesLocalAiOnly: false,
}

const PASSWORD_VAULT_AI_OPTIONS: { value: PasswordVaultAiAccessLevel; label: string }[] = [
  { value: "blocked", label: "Blocked" },
  { value: "count_only", label: "Count only" },
  { value: "metadata", label: "Redacted metadata" },
]


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
      queryClient.setQueryData<AiSecuritySettings>(queryKeys.aiSecuritySettings, (old) => {
        if (!old) return old
        const next = { ...old, ...patch }
        if (patch.passwordVaultAiShare) {
          next.passwordVaultAiShare = { ...old.passwordVaultAiShare, ...patch.passwordVaultAiShare }
        }
        if (patch.libraryToolAccess !== undefined) {
          next.libraryToolAccess = patch.libraryToolAccess
          next.readOnlyTools = patch.libraryToolAccess === "vision_only"
        } else if (patch.readOnlyTools !== undefined) {
          next.libraryToolAccess = patch.readOnlyTools ? "vision_only" : "full"
          next.readOnlyTools = patch.readOnlyTools
        }
        return next
      })
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

  function toggle(
    key: Exclude<
      keyof AiSecuritySettings,
      | "libraryToolAccess"
      | "readOnlyTools"
      | "passwordVaultAiAccess"
      | "passwordVaultAiShare"
      | "passwordQueriesLocalAiOnly"
    >,
  ) {
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
          label="Library tool access"
          hint="Full: search, bulk organize, and folder create/delete. Sandbox: search and folder create/delete only — no bulk organize. Read-only: vision search only."
        >
          <SettingsSegment<AiLibraryToolAccess>
            aria-label="Library tool access level"
            options={LIBRARY_TOOL_ACCESS_OPTIONS}
            value={s.libraryToolAccess}
            disabled={busy}
            onChange={(value) => {
              mutation.mutate(
                { libraryToolAccess: value },
                {
                  onSuccess: () => {
                    const label = LIBRARY_TOOL_ACCESS_OPTIONS.find((o) => o.value === value)?.label ?? value
                    toast.success(`Library tools: ${label}`)
                  },
                },
              )
            }}
          />
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
        icon={Lock}
        title="Password vault"
        description="Saved credentials stay encrypted on disk. The assistant never receives vault passwords."
      >
        <div className="mb-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-[12px] leading-relaxed text-zinc-600">
          The assistant never receives real passwords. When metadata is enabled, secrets appear as{" "}
          <span className="font-mono text-foreground">{VAULT_AI_ENCRYPTED}</span> in prompts—you see
          decrypted values in the Passwords page only.
        </div>
        <SettingRow
          label="AI vault awareness"
          hint="Blocked: no vault info. Count only: entry count. Redacted metadata: names/fields you allow below, always encrypted for passwords."
        >
          <SettingsSegment<PasswordVaultAiAccessLevel>
            aria-label="Password vault AI access"
            options={PASSWORD_VAULT_AI_OPTIONS}
            value={s.passwordVaultAiAccess}
            disabled={busy}
            onChange={(value) => {
              mutation.mutate(
                { passwordVaultAiAccess: value },
                {
                  onSuccess: () => {
                    const label =
                      PASSWORD_VAULT_AI_OPTIONS.find((o) => o.value === value)?.label ?? value
                    toast.success(`Password vault AI access: ${label}`)
                  },
                },
              )
            }}
          />
        </SettingRow>
        {s.passwordVaultAiAccess === "metadata" ? (
          <>
            <SettingRow label="Send entry names to AI" hint="Site titles such as Docker Hub Engine">
              <PillSwitch
                on={s.passwordVaultAiShare.names}
                disabled={busy}
                onChange={() =>
                  mutation.mutate({
                    passwordVaultAiShare: {
                      ...s.passwordVaultAiShare,
                      names: !s.passwordVaultAiShare.names,
                    },
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label="Send usernames to AI"
              hint={`When off, AI sees ${VAULT_AI_ENCRYPTED} instead of the login`}
            >
              <PillSwitch
                on={s.passwordVaultAiShare.usernames}
                disabled={busy}
                onChange={() =>
                  mutation.mutate({
                    passwordVaultAiShare: {
                      ...s.passwordVaultAiShare,
                      usernames: !s.passwordVaultAiShare.usernames,
                    },
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label="Send URLs to AI"
              hint={`When off, AI sees ${VAULT_AI_ENCRYPTED} instead of the link`}
            >
              <PillSwitch
                on={s.passwordVaultAiShare.urls}
                disabled={busy}
                onChange={() =>
                  mutation.mutate({
                    passwordVaultAiShare: {
                      ...s.passwordVaultAiShare,
                      urls: !s.passwordVaultAiShare.urls,
                    },
                  })
                }
              />
            </SettingRow>
            <SettingRow label="Send notes to AI" hint="Short notes only; off sends encrypted token">
              <PillSwitch
                on={s.passwordVaultAiShare.notes}
                disabled={busy}
                onChange={() =>
                  mutation.mutate({
                    passwordVaultAiShare: {
                      ...s.passwordVaultAiShare,
                      notes: !s.passwordVaultAiShare.notes,
                    },
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label="Passwords for AI"
              hint="Always encrypted for the assistant — cannot be enabled"
            >
              <PillSwitch on={false} disabled onChange={() => {}} />
            </SettingRow>
          </>
        ) : null}
        <SettingRow
          label="Password chat: local AI only"
          hint="When enabled, password-related questions in chat are sent only to an enabled Ollama profile—never cloud APIs."
        >
          <PillSwitch
            on={s.passwordQueriesLocalAiOnly}
            disabled={busy}
            onChange={() =>
              mutation.mutate(
                { passwordQueriesLocalAiOnly: !s.passwordQueriesLocalAiOnly },
                {
                  onSuccess: () => {
                    toast.success(
                      `Password chat local-only ${!s.passwordQueriesLocalAiOnly ? "enabled" : "disabled"}`,
                    )
                  },
                },
              )
            }
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