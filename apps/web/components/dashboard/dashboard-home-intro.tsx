"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { HardDrive } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { PlanBadge } from "@/components/license/plan-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { fetchApi } from "@/lib/api/client"
import { getGeneralSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useLicense } from "@/lib/license/use-license"
import { resolveUserGreeting, welcomeBackPhrase } from "@/lib/user/greeting"
import type { HealthStatus } from "@/lib/types/models"

function OverviewCornerStorageIcon() {
  return <IntroCornerIcon icon={HardDrive} />
}

export function DashboardHomeIntro() {
  const authQuery = useAuth()
  const license = useLicense()

  const generalQuery = useQuery({
    queryKey: queryKeys.generalSettings,
    queryFn: ({ signal }) => getGeneralSettings(signal),
  })

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  const identityLoading = authQuery.isLoading
  const serverUnreachable = healthQuery.isError || authQuery.isError

  const greeting = resolveUserGreeting({
    isLoading: identityLoading,
    isOffline: serverUnreachable || authQuery.isError || !authQuery.data?.user,
    fullName: authQuery.data?.user.name,
  })
  const welcomeName = welcomeBackPhrase(greeting)

  const instanceName = generalQuery.data?.instanceName ?? "Your instance"

  const subtitle = identityLoading ? (
    <Skeleton className="h-4 w-56 max-w-full rounded-md" />
  ) : welcomeName ? (
    `${instanceName} · welcome back, ${welcomeName}`
  ) : (
    `${instanceName} · welcome back`
  )

  return (
    <DashboardPageIntro
      title="Arciin"
      subtitle={subtitle}
      cornerDecoration={<OverviewCornerStorageIcon />}
      badge={
        license.ready ? (
          <Link
            href="/settings?tab=license"
            aria-label="View license and plan"
            className="inline-flex transition-opacity hover:opacity-85"
          >
            <PlanBadge plan={license.plan} />
          </Link>
        ) : undefined
      }
      className="border-zinc-200/80 bg-gradient-to-br from-white via-zinc-50/40 to-[#fff8f5]/80"
      description={
        <>
          Your private command center for files, libraries, and background work on this
          server. Drop files anywhere in the app—Arciin classifies them, stores the metadata
          here, and keeps activity visible in real time.
        </>
      }
    />
  )
}
