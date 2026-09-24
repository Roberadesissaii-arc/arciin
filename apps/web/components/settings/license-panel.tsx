"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { PlanBadge } from "@/components/license/plan-badge"
import { ConfirmDestructiveButton } from "@/components/shared/confirm-destructive-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SectionHeader,
  SettingsCard,
  SettingsFieldLabel,
  SettingsHint,
} from "@/components/settings/settings-panel-primitives"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  activateLicense,
  deactivateLicense,
  getLicenseStatus,
  refreshLicense,
} from "@/lib/api/license"
import { queryKeys } from "@/lib/api/query-keys"
import { accountUrl, pricingUrl, websiteHostLabel } from "@/lib/license/upgrade-url"
import { ApiError } from "@/lib/api/errors"
import { cn } from "@/lib/utils"

function StatusTone({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "ok"
      : status === "grace"
        ? "warn"
        : status === "expired"
          ? "bad"
          : "off"
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone === "ok" && "bg-emerald-500/10 text-emerald-600",
        tone === "warn" && "bg-amber-500/10 text-amber-700",
        tone === "bad" && "bg-red-500/10 text-red-600",
        tone === "off" && "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  )
}

/** Soft tier-colored wash for the plan hero band. */
function planTint(plan: string) {
  const tier = plan.toLowerCase()
  if (tier === "pro") {
    return "linear-gradient(135deg, color-mix(in srgb, var(--arciin-accent, #ff4f12) 10%, #ffffff) 0%, #ffffff 70%)"
  }
  if (tier === "team") {
    return "linear-gradient(135deg, rgba(124, 58, 237, 0.09) 0%, #ffffff 70%)"
  }
  if (tier === "business") {
    return "linear-gradient(135deg, rgba(24, 24, 27, 0.07) 0%, #ffffff 70%)"
  }
  return "linear-gradient(135deg, rgba(24, 24, 27, 0.04) 0%, #ffffff 70%)"
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function LicensePanel() {
  const queryClient = useQueryClient()
  const [key, setKey] = useState("")

  const statusQuery = useQuery({
    queryKey: queryKeys.licenseStatus,
    queryFn: ({ signal }) => getLicenseStatus(signal),
  })

  const activateMutation = useMutation({
    mutationFn: () => activateLicense(key.trim()),
    onSuccess: (data) => {
      toast.success(`${data.planName} activated.`, {
        description: "Premium features are unlocked on this instance.",
      })
      setKey("")
      // Write-through so UI never keeps a stale plan
      queryClient.setQueryData(queryKeys.licenseStatus, data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.licenseStatus })
    },
    onError: (err) => {
      toast.error("Activation failed", {
        description:
          err instanceof ApiError ? err.message : "Check the key and try again.",
      })
    },
  })

  const refreshMutation = useMutation({
    mutationFn: () => refreshLicense(),
    onSuccess: (data) => {
      toast.success("License refreshed.", {
        description: `Plan and status synced with the license server — currently ${data.planName}.`,
      })
      queryClient.setQueryData(queryKeys.licenseStatus, data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.licenseStatus })
    },
    onError: (err) => {
      toast.error("Refresh failed", {
        description:
          err instanceof ApiError ? err.message : "Could not reach the license server.",
      })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateLicense(),
    onSuccess: (data) => {
      toast.success("Returned to Free core.", {
        description: "Your files stay on this server. Premium features are now disabled.",
      })
      // Immediate free-core state — do not leave Pro in the cache for one frame
      queryClient.setQueryData(queryKeys.licenseStatus, data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.licenseStatus })
    },
    onError: (err) => {
      toast.error("Could not deactivate", {
        description: err instanceof ApiError ? err.message : "Try again in a moment.",
      })
    },
  })

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <SettingsPanelError
        message={
          statusQuery.error instanceof Error
            ? statusQuery.error.message
            : "Could not load license status."
        }
      />
    )
  }

  const s = statusQuery.data

  return (
    <div className="space-y-6 p-1">
      <SectionHeader
        icon={ShieldCheck}
        title="License"
        description="Free self-hosted core always keeps your files. Premium features unlock with an Arciin license. Files are never locked when a license expires."
      />

      <SettingsCard className="overflow-hidden p-0 sm:p-0">
        {/* Plan hero — tier-tinted band so the current plan reads at a glance */}
        <div
          className="border-b border-border px-4 py-5 sm:px-5"
          style={{ background: planTint(s.plan) }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SettingsFieldLabel>Current plan</SettingsFieldLabel>
              <div className="mt-1.5 flex items-center gap-2.5">
                <p className="text-2xl font-semibold tracking-tight text-foreground">
                  {s.planName}
                </p>
                <PlanBadge plan={s.plan} />
              </div>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                {s.planDescription}
              </p>
            </div>
            <StatusTone status={s.status} />
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* Key numbers as tiles instead of a packed grid */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <dt>
                <SettingsFieldLabel>Servers</SettingsFieldLabel>
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {s.servers
                  ? `${s.servers.activated} / ${s.servers.limit === "custom" ? "Custom" : s.servers.limit}`
                  : "—"}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <dt>
                <SettingsFieldLabel>Renews / expires</SettingsFieldLabel>
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {formatDate(s.expiresAt)}
              </dd>
            </div>
            <div className="col-span-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 sm:col-span-1">
              <dt>
                <SettingsFieldLabel>Premium features</SettingsFieldLabel>
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    s.premiumActive ? "bg-emerald-500" : "bg-zinc-300",
                  )}
                  aria-hidden
                />
                {s.premiumActive ? "Enabled" : "Free core only"}
              </dd>
            </div>
          </dl>

          {/* Quiet identity / lifecycle rows */}
          <dl className="divide-y divide-border rounded-lg border border-border">
            {[
              { label: "Instance ID", value: s.instanceId ?? "—", mono: true },
              { label: "License key", value: s.keyPrefix ?? "—", mono: true },
              { label: "Activated", value: formatDate(s.activatedAt) },
              { label: "Grace until", value: formatDate(s.graceUntil) },
              {
                label: "Last check-in",
                value: formatDate(s.servers?.lastCheckIn ?? s.activatedAt),
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2"
              >
                <dt className="text-[12px] font-medium text-muted-foreground">{row.label}</dt>
                <dd
                  className={cn(
                    "break-all text-right text-[12.5px] text-foreground",
                    row.mono && "font-mono text-[12px]",
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <SettingsHint>
            Your libraries, uploads, and downloads stay available on Free. License only gates
            premium automation — never your data on this disk.
          </SettingsHint>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
            >
              {refreshMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh status
            </Button>
            {!s.isFreeCore || s.keyPrefix ? (
              <ConfirmDestructiveButton
                variant="ghost"
                title="Return this instance to Free core?"
                description="Paid features stop working on this server. Your files stay on disk, and you can activate the licence again later."
                confirmLabel="Deactivate license"
                pending={deactivateMutation.isPending}
                onConfirm={() => deactivateMutation.mutateAsync()}
              >
                Deactivate license
              </ConfirmDestructiveButton>
            ) : null}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <p className="text-[14px] font-semibold text-foreground">
            Activate a license
          </p>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Paste the license key from your Arciin order,{" "}
          <a
            href={pricingUrl()}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[color:var(--arciin-accent,#FF4F12)] underline decoration-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_40%,transparent)] underline-offset-2 hover:decoration-[color:var(--arciin-accent,#FF4F12)]"
          >
            view plans on {websiteHostLabel()}
          </a>
          , or{" "}
          <a
            href={accountUrl()}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[color:var(--arciin-accent,#FF4F12)] underline decoration-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_40%,transparent)] underline-offset-2 hover:decoration-[color:var(--arciin-accent,#FF4F12)]"
          >
            open your Arciin account
          </a>
          .
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
          <span
            className={cn(
              "mt-0.5 size-1.5 shrink-0 rounded-full",
              s.licenseServerConfigured ? "bg-emerald-500" : "bg-amber-500",
            )}
            aria-hidden
          />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {s.licenseServerConfigured ? (
              <>
                <span className="font-semibold text-foreground">License server connected.</span>{" "}
                Activation validates online and stores a signed token on this instance.
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground">License server not configured.</span>{" "}
                Set <span className="font-mono text-foreground/80">ARCIIN_LICENSE_SERVER_URL</span>{" "}
                so this instance can validate keys from {websiteHostLabel()}.
              </>
            )}
          </p>
        </div>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!key.trim()) return
            activateMutation.mutate()
          }}
        >
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your Arciin license key"
            className="font-mono text-[13px] sm:flex-1"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={activateMutation.isPending || !key.trim()}>
            {activateMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Activate"
            )}
          </Button>
        </form>
      </SettingsCard>

      <SettingsCard className="bg-muted/15">
        <p className="text-[13px] font-semibold text-foreground">
          Allowed features on this plan
        </p>
        <ul className="mt-3 columns-1 gap-x-8 sm:columns-2">
          {s.features.map((f) => (
            <li
              key={f.id}
              className="mb-1.5 break-inside-avoid text-[12.5px] text-muted-foreground"
            >
              <span className="mr-1.5 inline-block size-1 rounded-full bg-[var(--arciin-accent,#FF4F12)]" />
              {f.label}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
          Expired licenses return to Free core after a grace period. Your libraries, uploads, and
          downloads are never locked by licensing.
        </p>
      </SettingsCard>
    </div>
  )
}
