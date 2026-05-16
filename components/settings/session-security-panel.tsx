"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import { toast } from "sonner"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { SettingsSegment } from "@/components/settings/settings-segment"
import { getSecuritySettings, updateSecuritySettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { SecuritySettings } from "@/lib/types/models"

const IDLE_TIMEOUT_OPTIONS = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hr", value: 60 },
  { label: "2 hrs", value: 120 },
  { label: "4 hrs", value: 240 },
] as const

export function SessionSecurityPanel() {
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: queryKeys.securitySettings,
    queryFn: ({ signal }) => getSecuritySettings(signal),
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
      toast.error("Could not save session settings.")
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.securitySettings })
    },
  })

  const d = settingsQuery.data
  const busy = mutation.isPending || settingsQuery.isLoading

  function save(patch: Partial<SecuritySettings>, label: string) {
    mutation.mutate(patch, { onSuccess: () => toast.success(label) })
  }

  if (settingsQuery.isLoading) {
    return <Skeleton className="h-56 rounded-2xl" />
  }

  const idleEnabled = d?.idleLogoutEnabled ?? true
  const idleMinutes = d?.idleLogoutMinutes ?? 30

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={LogOut}
            title="Session & logout"
            description="Control automatic sign-out when this browser tab stays idle"
          />
        </CardHeader>
        <CardContent>
          <SettingRow
            label="Idle auto-logout"
            hint="Sign out automatically after no mouse, keyboard, scroll, or touch activity"
          >
            <PillSwitch
              on={idleEnabled}
              disabled={busy}
              onChange={() => {
                const next = !idleEnabled
                save(
                  { idleLogoutEnabled: next },
                  next ? "Idle auto-logout enabled" : "Idle auto-logout disabled",
                )
              }}
            />
          </SettingRow>

          {idleEnabled ? (
            <SettingRow
              label="Idle timeout"
              hint="Applies to this browser while you are signed in to the dashboard"
            >
              <SettingsSegment
                aria-label="Idle timeout"
                options={[...IDLE_TIMEOUT_OPTIONS]}
                value={idleMinutes}
                disabled={busy}
                onChange={(value) =>
                  save({ idleLogoutMinutes: value }, `Idle timeout: ${formatIdle(value)}`)
                }
              />
            </SettingRow>
          ) : null}

          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            Session lifetime under{" "}
            <span className="font-medium text-foreground">Access control</span> still limits how
            long a sign-in cookie remains valid. Idle logout is separate: it ends your session when
            you step away from an open tab.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function formatIdle(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return hours === 1 ? "1 hr" : `${hours} hrs`
}
