"use client"

import { Bell, Radio, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"
import {
  anyNotificationChannelEnabled,
  notificationPrefsSummary,
  sendTestNotification,
  sendTestNotificationSuite,
  type NotificationTestKind,
} from "@/lib/notifications/send-test-notification"
import { useSocketStore } from "@/lib/stores/socket-store"
import { cn } from "@/lib/utils"

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        ok ? "bg-emerald-500" : "bg-zinc-300",
      )}
      aria-hidden
    />
  )
}

function TestButton({
  label,
  kind,
  disabled,
}: {
  label: string
  kind: NotificationTestKind
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 border-border bg-card text-[12px]"
      disabled={disabled}
      onClick={() => sendTestNotification(kind)}
    >
      {label}
    </Button>
  )
}

export function NotificationsSettingsPanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.notifications
  const busy = mutation.isPending
  const connected = useSocketStore((s) => s.connected)
  const lastEventAt = useSocketStore((s) => s.lastEventAt)

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (query.isError || !prefs) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : "Could not load notification preferences."
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
        <p className="font-medium">{message}</p>
        <p className="mt-1 text-[12px] text-red-700/90">
          Run <code className="rounded bg-red-100 px-1">pnpm db:deploy</code> then restart the API with{" "}
          <code className="rounded bg-red-100 px-1">pnpm dev:api</code> (or full{" "}
          <code className="rounded bg-red-100 px-1">pnpm dev</code>).
        </p>
      </div>
    )
  }

  const summary = notificationPrefsSummary()
  const anyOn = anyNotificationChannelEnabled()

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Radio}
            title="Status"
            description="Arciin uses in-browser toasts (Sonner), not email or push. Check that realtime and toggles are working."
          />
        </CardHeader>
        <CardContent className="space-y-3 text-[13px] text-zinc-600">
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
            <StatusDot ok={connected} />
            <span>
              Realtime:{" "}
              <span className="font-medium text-foreground">
                {connected ? "Connected" : "Not connected"}
              </span>
              {connected && lastEventAt ? (
                <span className="text-zinc-500"> · last event received</span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
            <StatusDot ok={anyOn} />
            <span>
              Channels:{" "}
              <span className="font-medium text-foreground">
                {anyOn ? "At least one enabled" : "All off — you will not see toasts"}
              </span>
            </span>
          </div>
          <ul className="list-inside list-disc space-y-1 text-[12px] text-zinc-500">
            <li>Upload toasts fire when you drop files (this browser).</li>
            <li>Activity toasts need realtime connected and Activity feed enabled.</li>
            <li>Security toasts need Security events on and login alerts in Access control.</li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              className="h-9 bg-primary text-white hover:bg-primary/90"
              onClick={() => sendTestNotificationSuite()}
            >
              <Sparkles className="size-4" />
              Test all enabled
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Bell}
            title="Uploads"
            description="Sounds and toasts when files finish or fail in this browser."
          />
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow label="Upload completion sound" hint="Short tone when an upload reaches ready">
            <PillSwitch
              on={prefs.uploadSound}
              disabled={busy}
              onChange={() =>
                patch(
                  { notifications: { uploadSound: !prefs.uploadSound } },
                  prefs.uploadSound ? "Upload sound off" : "Upload sound on",
                )
              }
            />
          </SettingRow>
          <div className="flex flex-wrap gap-2 px-1 pb-3">
            <TestButton label="Test sound" kind="upload-sound" disabled={busy} />
          </div>
          <SettingRow label="Upload complete toast" hint="Toast when uploads succeed">
            <PillSwitch
              on={prefs.uploadCompleteToast}
              disabled={busy}
              onChange={() =>
                patch(
                  { notifications: { uploadCompleteToast: !prefs.uploadCompleteToast } },
                  prefs.uploadCompleteToast ? "Complete toasts off" : "Complete toasts on",
                )
              }
            />
          </SettingRow>
          <SettingRow label="Upload failed toast" hint="Toast when an upload errors">
            <PillSwitch
              on={prefs.uploadFailedToast}
              disabled={busy}
              onChange={() =>
                patch(
                  { notifications: { uploadFailedToast: !prefs.uploadFailedToast } },
                  prefs.uploadFailedToast ? "Failed toasts off" : "Failed toasts on",
                )
              }
            />
          </SettingRow>
          <div className="flex flex-wrap gap-2 px-1 pb-1">
            <TestButton
              label="Test complete"
              kind="upload-complete"
              disabled={busy || !summary.uploadCompleteToast}
            />
            <TestButton
              label="Test failed"
              kind="upload-failed"
              disabled={busy || !summary.uploadFailedToast}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Bell}
            title="Activity & security"
            description="Live events over the socket and optional security alerts."
          />
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow label="Activity feed toasts" hint="When uploads, moves, and other actions are recorded">
            <PillSwitch
              on={prefs.activityFeedToast}
              disabled={busy}
              onChange={() =>
                patch(
                  { notifications: { activityFeedToast: !prefs.activityFeedToast } },
                  prefs.activityFeedToast ? "Activity toasts off" : "Activity toasts on",
                )
              }
            />
          </SettingRow>
          <SettingRow
            label="Security events"
            hint="Failed sign-in attempts (requires login alerts under Access control)"
          >
            <PillSwitch
              on={prefs.securityEventsToast}
              disabled={busy}
              onChange={() =>
                patch(
                  { notifications: { securityEventsToast: !prefs.securityEventsToast } },
                  prefs.securityEventsToast ? "Security toasts off" : "Security toasts on",
                )
              }
            />
          </SettingRow>
          <div className="flex flex-wrap gap-2 px-1 pt-2">
            <TestButton
              label="Test activity"
              kind="activity"
              disabled={busy || !summary.activityFeedToast}
            />
            <TestButton
              label="Test security"
              kind="security"
              disabled={busy || !summary.securityEventsToast}
            />
          </div>
        </CardContent>
      </Card>

      <p className="px-1 text-[12px] text-zinc-500">
        Preferences are saved to your account. Toast position and style are under{" "}
        <a href="/settings?tab=appearance" className="font-medium text-primary underline-offset-2 hover:underline">
          Settings → Appearance
        </a>
        . Live socket events are on{" "}
        <a href="/events" className="font-medium text-primary underline-offset-2 hover:underline">
          Events
        </a>
        . Email digests are not available yet.
      </p>
    </div>
  )
}
