"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ExternalLink, RefreshCw, Sparkles } from "lucide-react"
import { notifyAutoUpdateToggled, notifyError, notifySuccess } from "@/lib/notifications/toast-actions"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
  SettingsCard,
  SettingsFieldLabel,
  SettingsHint,
} from "@/components/settings/settings-panel-primitives"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  applyStagedUpdate,
  getAutoUpdateSettings,
  getUpdateCheck,
  updateAutoUpdateSettings,
  type AutoUpdateConfig,
  type UpdateCheckResult,
} from "@/lib/api/instance"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/shared/relative-time"
import { useLicense } from "@/lib/license/use-license"

function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:00 ${period}`
}

export function UpdatesPanel() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.updateCheck,
    queryFn: ({ signal }) => getUpdateCheck({ signal }),
    staleTime: 5 * 60 * 1000,
  })

  const autoUpdateQuery = useQuery({
    queryKey: queryKeys.autoUpdateSettings,
    queryFn: ({ signal }) => getAutoUpdateSettings(signal),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })

  async function refresh() {
    const result = await getUpdateCheck({ refresh: true })
    queryClient.setQueryData(queryKeys.updateCheck, result)
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Sparkles}
        title="Software updates"
        description="Arciin is self-hosted software you control — updates are applied manually, never automatically."
      />

      {query.isLoading ? (
        <SettingsCard>
          <Skeleton className="h-24 w-full rounded-lg" />
        </SettingsCard>
      ) : query.isError ? (
        <SettingsPanelError
          message="Could not check for updates."
          hint={query.error instanceof Error ? query.error.message : undefined}
        />
      ) : query.data ? (
        <UpdateStatusCard data={query.data} onRefresh={refresh} refreshing={query.isFetching} />
      ) : null}

      {autoUpdateQuery.data ? <AutoUpdateCard data={autoUpdateQuery.data} /> : null}
    </div>
  )
}

function AutoUpdateCard({ data }: { data: AutoUpdateConfig }) {
  const queryClient = useQueryClient()
  const license = useLicense()
  const autoUpdatesLocked = license.shouldPaywall("ops.auto_updates")
  const hour = data.hour ?? 2

  const saveMutation = useMutation({
    mutationFn: (input: { enabled: boolean; hour: number | null }) => updateAutoUpdateSettings(input),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.autoUpdateSettings, result)
      notifyAutoUpdateToggled(result.enabled)
    },
    onError: (e) =>
      notifyError(
        "Could not save automatic update settings",
        e instanceof Error ? e.message : "Try again in a moment.",
      ),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyStagedUpdate(),
    onSuccess: () => {
      notifySuccess(
        "Applying update",
        "Services are restarting now — this takes a few seconds and briefly interrupts active uploads.",
      )
    },
    onError: (e) =>
      notifyError(
        "Could not apply the staged update",
        e instanceof Error ? e.message : "Try again in a moment.",
      ),
  })

  return (
    <SettingsCard className="space-y-3">
      <SettingRow
        label="Automatic updates"
        hint={
          autoUpdatesLocked
            ? "Automatic staging is a Pro capability. Checking for updates stays available on every plan."
            : "At your chosen hour, Arciin downloads and builds a new version in the background — nothing is applied until you click Apply."
        }
      >
        <PillSwitch
          on={data.enabled}
          disabled={saveMutation.isPending || autoUpdatesLocked}
          onChange={() => saveMutation.mutate({ enabled: !data.enabled, hour: data.enabled ? null : hour })}
        />
      </SettingRow>

      {data.enabled ? (
        <SettingRow label="Stage updates around" hint="Local server time — pick an hour you're usually asleep">
          <Select
            value={String(hour)}
            disabled={saveMutation.isPending || autoUpdatesLocked}
            onValueChange={(value) => saveMutation.mutate({ enabled: true, hour: Number(value) })}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      ) : null}

      {data.stagedVersion ? (
        <div className="space-y-2.5 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-0 bg-primary text-[11px] font-semibold text-primary-foreground shadow-none">
              Update staged
            </Badge>
            <span className="font-mono text-[13px] font-semibold text-foreground">v{data.stagedVersion}</span>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Downloaded and built — nothing has changed yet. Applying restarts Arciin&apos;s services, which takes a
            few seconds and briefly interrupts any active uploads or streams.
          </p>
          <Button
            type="button"
            size="sm"
            className="bg-primary text-white hover:bg-primary/90"
            disabled={applyMutation.isPending || autoUpdatesLocked}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending ? "Applying…" : "Apply now"}
          </Button>
        </div>
      ) : null}

      {data.lastError ? (
        <SettingsPanelError message="The last automatic stage attempt failed." hint={data.lastError.split("\n")[0]} />
      ) : null}

      {data.lastCheckedAt ? (
        <p className="text-[11px] text-muted-foreground">
          Last automatic check <RelativeTime value={data.lastCheckedAt} />
        </p>
      ) : null}
    </SettingsCard>
  )
}

function UpdateStatusCard({
  data,
  onRefresh,
  refreshing,
}: {
  data: UpdateCheckResult
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <SettingsCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <SettingsFieldLabel>Current version</SettingsFieldLabel>
          <p className="font-mono text-[15px] font-semibold text-foreground">v{data.currentVersion}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 border-border bg-card text-foreground hover:bg-muted/50"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Check for updates
        </Button>
      </div>

      {!data.configured ? (
        <SettingsHint>
          No update manifest is configured for this instance. Set{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">ARCIIN_UPDATE_MANIFEST_URL</code>{" "}
          to a JSON manifest URL to enable update checks. This is optional — your instance runs fine without it.
        </SettingsHint>
      ) : data.error ? (
        <SettingsPanelError message="The update manifest could not be reached." hint={data.error} />
      ) : data.updateAvailable ? (
        <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-0 bg-primary text-[11px] font-semibold text-primary-foreground shadow-none">
              Update available
            </Badge>
            <span className="font-mono text-[13px] font-semibold text-foreground">v{data.latestVersion}</span>
            {data.channel ? (
              <span className="text-[11px] text-muted-foreground">· {data.channel}</span>
            ) : null}
          </div>
          {data.notes ? <p className="text-[13px] text-muted-foreground">{data.notes}</p> : null}
          {data.changelogUrl ? (
            <a
              href={data.changelogUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
            >
              View changelog
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          <SettingsHint>
            Arciin never updates itself. To apply this release on a Docker install, run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">docker compose pull && docker compose up -d</code>{" "}
            from your install directory. For a native/PM2 install, re-run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">install.sh</code>.
          </SettingsHint>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <p className="text-[13px] font-medium text-foreground">You&apos;re on the latest version.</p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Last checked <RelativeTime value={data.checkedAt} />
      </p>
    </SettingsCard>
  )
}
