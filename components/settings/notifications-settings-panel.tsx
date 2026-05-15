"use client"

import { Bell } from "lucide-react"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"

export function NotificationsSettingsPanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.notifications
  const busy = mutation.isPending

  if (query.isLoading) {
    return (
      <div className="space-y-4">
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

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Bell}
            title="Uploads"
            description="Sounds and toasts when files finish or fail in this browser."
          />
        </CardHeader>
        <CardContent>
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
          <SettingRow label="Upload complete toast" hint="Sonner notification when uploads succeed">
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
          <SettingRow label="Upload failed toast" hint="Alert when an upload errors">
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
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Bell}
            title="Activity & security"
            description="Live events from sockets and instance security alerts."
          />
        </CardHeader>
        <CardContent>
          <SettingRow label="Activity feed toasts" hint="Notify when new activity events arrive">
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
          <SettingRow label="Security events" hint="Toast on failed logins when login alerts are enabled">
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
        </CardContent>
      </Card>

      <p className="px-1 text-[12px] text-zinc-500">
        Saved to your account and applied on every device after sign-in. Email digests are not available yet.
      </p>
    </div>
  )
}
