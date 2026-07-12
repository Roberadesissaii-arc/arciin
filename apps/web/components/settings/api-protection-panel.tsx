"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Gauge, Key, Network, Plus, Shield, Trash2 } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"
import { notifyIpPolicy } from "@/lib/notifications/toast-actions"
import type { IpPolicyAction } from "@/lib/notifications/toast-copy"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { SettingsSegment } from "@/components/settings/settings-segment"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  getApiProtectionStatus,
  getSecuritySettings,
  patchApiProtectionIpRule,
  updateSecuritySettings,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { SecuritySettings } from "@/lib/types/models"

const RPM_PRESETS = [
  { label: "Off", value: 0 },
  { label: "120", value: 120 },
  { label: "600", value: 600 },
  { label: "3k", value: 3000 },
  { label: "12k", value: 12000 },
] as const

const KEY_RPM_PRESETS = [
  { label: "Off", value: 0 },
  { label: "60", value: 60 },
  { label: "300", value: 300 },
  { label: "1.2k", value: 1200 },
] as const

const EXPIRY_PRESETS = [
  { label: "Unlimited", value: 0 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "180d", value: 180 },
  { label: "365d", value: 365 },
] as const


function IpList({
  items,
  emptyLabel,
  onRemove,
  busy,
}: {
  items: string[]
  emptyLabel: string
  onRemove: (ip: string) => void
  busy: boolean
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-zinc-500">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.map((ip) => (
        <li
          key={ip}
          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5"
        >
          <code className="font-mono text-[12px] text-foreground">{ip}</code>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(ip)}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            aria-label={`Remove ${ip}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ApiProtectionPanel() {
  const queryClient = useQueryClient()
  const [ipInput, setIpInput] = useState("")

  const settingsQuery = useQuery({
    queryKey: queryKeys.securitySettings,
    queryFn: ({ signal }) => getSecuritySettings(signal),
  })

  const statusQuery = useQuery({
    queryKey: queryKeys.apiProtectionStatus,
    queryFn: ({ signal }) => getApiProtectionStatus(signal),
    refetchInterval: 30_000,
  })

  const mutation = useMutation({
    mutationFn: updateSecuritySettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.securitySettings })
      const prev = queryClient.getQueryData<SecuritySettings>(queryKeys.securitySettings)
      queryClient.setQueryData<SecuritySettings>(queryKeys.securitySettings, (old) =>
        old ? { ...old, ...patch } : old,
      )
      return { prev }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.securitySettings, ctx.prev)
      toast.error("Could not save API protection settings", {
        description: "Your change was reverted. Try again in a moment.",
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.securitySettings })
      queryClient.invalidateQueries({ queryKey: queryKeys.apiProtectionStatus })
    },
  })

  const ipMutation = useMutation({
    mutationFn: patchApiProtectionIpRule,
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.securitySettings })
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiProtectionStatus })
      const actionMap = {
        block: "blocked",
        allow: "allowlisted",
        unblock: "unblocked",
        disallow: "disallowlisted",
      } as const satisfies Record<
        typeof vars.action,
        IpPolicyAction
      >
      notifyIpPolicy(actionMap[vars.action], vars.ip)
      queryClient.setQueryData<SecuritySettings>(queryKeys.securitySettings, (old) =>
        old
          ? { ...old, ipBlocklist: data.ipBlocklist, ipAllowlist: data.ipAllowlist }
          : old,
      )
    },
    onError: (err) => {
      toast.error("Could not update IP rule", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
    },
  })

  const status = statusQuery.data
  const busy = mutation.isPending || ipMutation.isPending

  function save(patch: Partial<SecuritySettings>, label: string) {
    mutation.mutate(patch, {
      onSuccess: () =>
        toast.success(label, { description: "API protection settings updated for this instance." }),
    })
  }

  function addIp(action: "block" | "allow") {
    const ip = ipInput.trim()
    if (!ip) return
    ipMutation.mutate({ action, ip }, { onSuccess: () => setIpInput("") })
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <SettingsPanelError
        message={
          settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : "Could not load API protection settings."
        }
        hint="Check that the API is running, then refresh this page."
      />
    )
  }

  const d = settingsQuery.data
  const globalRpm = d.apiGlobalRequestsPerMinute ?? 0
  const keyRpm = d.apiKeyRequestsPerMinute ?? 0
  const maxDays = d.maxApiKeyExpiryDays ?? 0
  const blocklist = d.ipBlocklist ?? []
  const allowlist = d.ipAllowlist ?? []

  return (
    <div className="space-y-4">
      {status && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Active API keys", value: String(status.activeApiKeys) },
            {
              label: "Global limit",
              value: status.globalLimitEnabled ? `${status.globalLimitPerMinute}/min` : "Off",
            },
            {
              label: "This minute",
              value:
                status.requestsThisMinute !== null
                  ? `${status.requestsThisMinute} req`
                  : "—",
            },
            {
              label: "Per-key limit",
              value: status.perKeyLimitEnabled ? `${status.perKeyLimitPerMinute}/min` : "Off",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-muted/30 px-3 py-2.5"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{stat.label}</p>
              <p className="mt-0.5 text-[15px] font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Gauge}
            title="Rate limits"
            description="Enforced on your Arciin API server using Redis — not documentation-only"
          />
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="mb-2 text-[13px] font-medium text-foreground">Global requests per minute</p>
            <p className="mb-3 text-[12px] text-zinc-500">
              Applies to all HTTP traffic on /api (except health, login, and setup). Returns 429 when exceeded.
            </p>
            <SettingsSegment
              aria-label="Global rate limit"
              options={[...RPM_PRESETS]}
              value={globalRpm}
              disabled={busy}
              onChange={(value) =>
                save({ apiGlobalRequestsPerMinute: value }, `Global rate limit: ${value === 0 ? "off" : `${value}/min`}`)
              }
            />
          </div>
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[13px] font-medium text-foreground">Per API key requests per minute</p>
            <p className="mb-3 text-[12px] text-zinc-500">
              Applies when clients authenticate with Authorization: Bearer arc_…
            </p>
            <SettingsSegment
              aria-label="Per API key rate limit"
              options={[...KEY_RPM_PRESETS]}
              value={keyRpm}
              disabled={busy}
              onChange={(value) =>
                save(
                  { apiKeyRequestsPerMinute: value },
                  `Per-key rate limit: ${value === 0 ? "off" : `${value}/min`}`,
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Key}
            title="API key policy"
            description="Rules enforced when creating keys under Developer → API Keys"
          />
        </CardHeader>
        <CardContent>
          <SettingRow
            label="Require expiry on new keys"
            hint="Reject key creation without an expiresAt date"
          >
            <PillSwitch
              on={d?.requireApiKeyExpiry ?? false}
              onChange={() => {
                const next = !(d?.requireApiKeyExpiry ?? false)
                save({ requireApiKeyExpiry: next }, next ? "Expiry required on new keys" : "Expiry optional on new keys")
              }}
              disabled={busy || !d}
            />
          </SettingRow>
          <div className="border-b border-border py-3.5 last:border-0">
            <p className="mb-2 text-[13px] font-medium text-foreground">Maximum key lifetime</p>
            <p className="mb-3 text-[12px] text-zinc-500">
              Keys with expiry beyond this window are rejected at creation time.
            </p>
            <SettingsSegment
              aria-label="Maximum API key lifetime"
              options={[...EXPIRY_PRESETS]}
              value={maxDays}
              disabled={busy}
              onChange={(value) =>
                save(
                  { maxApiKeyExpiryDays: value },
                  value === 0 ? "Key lifetime: unlimited" : `Key lifetime: max ${value} days`,
                )
              }
            />
            <p className="mt-3 text-[12px] text-zinc-500">
              <Link href="/developer/api-keys" className="font-medium text-primary hover:underline">
                Manage API keys →
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Network}
            title="IP access"
            description="Block or allow client IPs on the API — enforced before rate limits"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {(d?.enforceIpAllowlist && allowlist.length === 0) && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-950">
              Allowlist enforcement is on but no addresses are listed. Remote clients are not blocked until you
              add at least one allow rule (loopback is always permitted).
            </div>
          )}
          <SettingRow
            label="Enforce allowlist"
            hint="When on, only listed IPs/CIDRs can call the API (login and setup stay open; loopback always allowed)"
          >
            <PillSwitch
              on={d?.enforceIpAllowlist ?? false}
              onChange={() => {
                const next = !(d?.enforceIpAllowlist ?? false)
                if (next && allowlist.length === 0) {
                  toast.error("Allowlist is empty", {
                    description: "Add at least one address before enforcing it.",
                  })
                  return
                }
                save(
                  { enforceIpAllowlist: next },
                  next ? "IP allowlist enforcement enabled" : "IP allowlist enforcement disabled",
                )
              }}
              disabled={busy || !d}
            />
          </SettingRow>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder="203.0.113.10 or 10.0.0.0/8"
              className="h-9 border-border bg-white text-foreground"
              disabled={busy}
            />
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !ipInput.trim()}
                className="gap-1.5"
                onClick={() => addIp("block")}
              >
                <Plus className="size-3.5" />
                Block
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !ipInput.trim()}
                className="gap-1.5"
                onClick={() => addIp("allow")}
              >
                <Plus className="size-3.5" />
                Allow
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                <Shield className="size-3.5" />
                Blocklist ({blocklist.length})
              </p>
              <IpList
                items={blocklist}
                emptyLabel="No blocked addresses."
                busy={busy}
                onRemove={(ip) => ipMutation.mutate({ action: "unblock", ip })}
              />
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                Allowlist ({allowlist.length})
              </p>
              <IpList
                items={allowlist}
                emptyLabel="No allowlisted addresses."
                busy={busy}
                onRemove={(ip) => ipMutation.mutate({ action: "disallow", ip })}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
