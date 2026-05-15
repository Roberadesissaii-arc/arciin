"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UserCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { SettingsSegment } from "@/components/settings/settings-segment"
import {
  getAccessControlStatus,
  getSecuritySettings,
  revokeAllSessionsExceptCurrent,
  updateSecuritySettings,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { SecuritySettings } from "@/lib/types/models"

const TIMEOUT_OPTIONS = [
  { label: "30 min", value: 30 },
  { label: "2 hrs", value: 120 },
  { label: "8 hrs", value: 480 },
  { label: "24 hrs", value: 1440 },
  { label: "7 days", value: 10080 },
] as const

const MAX_FAILED_OPTIONS = [
  { label: "3", value: 3 },
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
] as const


export function AccessControlPanel() {
  const queryClient = useQueryClient()
  const [revokeOpen, setRevokeOpen] = useState(false)

  const settingsQuery = useQuery({
    queryKey: queryKeys.securitySettings,
    queryFn: ({ signal }) => getSecuritySettings(signal),
  })

  const statusQuery = useQuery({
    queryKey: queryKeys.accessControlStatus,
    queryFn: ({ signal }) => getAccessControlStatus(signal),
    staleTime: 15_000,
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
      toast.error("Could not save settings.")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.securitySettings })
      queryClient.invalidateQueries({ queryKey: queryKeys.accessControlStatus })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeAllSessionsExceptCurrent,
    onSuccess: (data) => {
      toast.success(
        data.revoked === 0
          ? "No other sessions to revoke."
          : `Revoked ${data.revoked} session${data.revoked === 1 ? "" : "s"}.`,
      )
      setRevokeOpen(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.accessControlStatus })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not revoke sessions.")
    },
  })

  const d = settingsQuery.data
  const activeSessions = statusQuery.data?.activeSessions
  const busy = mutation.isPending || settingsQuery.isLoading

  function save(patch: Partial<SecuritySettings>, label: string) {
    mutation.mutate(patch, { onSuccess: () => toast.success(label) })
  }

  if (settingsQuery.isLoading) {
    return <Skeleton className="h-72 rounded-2xl" />
  }

  const sessionTimeout = d?.sessionTimeoutMinutes ?? 1440
  const maxFailed = d?.maxFailedLogins ?? 10

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={UserCheck}
            title="Access control"
            description="Policies enforced when users sign in, register, or hold a session"
          />
        </CardHeader>
        <CardContent>
          <SettingRow
            label="Public signup"
            hint="Allow new MEMBER accounts via /api/auth/register"
          >
            <PillSwitch
              on={d?.publicSignupEnabled ?? false}
              disabled={busy}
              onChange={() => {
                const next = !(d?.publicSignupEnabled ?? false)
                save(
                  { publicSignupEnabled: next },
                  next ? "Public signup enabled" : "Public signup disabled",
                )
              }}
            />
          </SettingRow>

          <SettingRow
            label="Session lifetime"
            hint="How long a sign-in stays valid before users must log in again"
          >
            <SettingsSegment
              aria-label="Session lifetime"
              options={[...TIMEOUT_OPTIONS]}
              value={sessionTimeout}
              disabled={busy}
              onChange={(value) =>
                save({ sessionTimeoutMinutes: value }, `Session lifetime: ${formatTimeout(value)}`)
              }
            />
          </SettingRow>

          <SettingRow
            label="Login failure alerts"
            hint="Write failed sign-in attempts to the activity feed"
          >
            <PillSwitch
              on={d?.loginAlertsEnabled ?? false}
              disabled={busy}
              onChange={() => {
                const next = !(d?.loginAlertsEnabled ?? false)
                save(
                  { loginAlertsEnabled: next },
                  next ? "Login alerts enabled" : "Login alerts disabled",
                )
              }}
            />
          </SettingRow>

          <SettingRow
            label="Max failed logins"
            hint="Lock the email for 15 minutes after this many wrong passwords"
          >
            <SettingsSegment
              aria-label="Max failed logins"
              options={[...MAX_FAILED_OPTIONS]}
              value={maxFailed}
              disabled={busy}
              onChange={(value) =>
                save({ maxFailedLogins: value }, `Max failed logins: ${value}`)
              }
            />
          </SettingRow>

          <SettingRow
            label="Sign out other devices"
            hint={
              activeSessions != null
                ? `${activeSessions} active session${activeSessions === 1 ? "" : "s"} on this instance (yours is kept)`
                : "End every session except the browser you are using now"
            }
          >
            <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-border text-foreground hover:bg-muted/60"
                  disabled={revokeMutation.isPending}
                >
                  Revoke sessions
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-sm border-zinc-200 bg-white text-zinc-900 shadow-xl ring-zinc-200/80">
                <AlertDialogHeader className="text-left sm:place-items-start sm:text-left">
                  <AlertDialogTitle className="text-zinc-900">
                    Revoke all other sessions?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-500">
                    Everyone else will be signed out immediately and must log in again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="border-t border-zinc-100 bg-zinc-50/80">
                  <AlertDialogCancel className="border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => revokeMutation.mutate()}
                  >
                    Revoke
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SettingRow>
        </CardContent>
      </Card>

      <p className="px-1 text-[12px] text-zinc-500">
        Rate limits and IP rules:{" "}
        <Link href="/settings?tab=api-protection" className="font-medium text-primary hover:underline">
          API protection
        </Link>
        . Failed logins (when alerts are on):{" "}
        <Link href="/activity" className="font-medium text-primary hover:underline">
          Activity
        </Link>
        .
      </p>
    </div>
  )
}

function formatTimeout(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hrs`
  if (minutes < 10080) return `${Math.round(minutes / 1440)} days`
  return `${minutes} min`
}
