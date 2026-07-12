"use client"

import { PackagePlus } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { getIntegrations } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"


export function IntegrationsPageIntro() {
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations,
    queryFn: ({ signal }) => getIntegrations(signal),
  })

  const list = integrationsQuery.data ?? []
  const connected = list.filter((i) => i.enabled).length

  return (
    <DashboardPageIntro
      title="Integrations"
      subtitle="Connectors · automation · same self-hosted instance"
      cornerDecoration={<IntroCornerIcon icon={PackagePlus} />}
      className="border-zinc-200/80 bg-gradient-to-br from-white via-zinc-50/40 to-[#fff8f5]/80"
      description="Arciin stays local-first: files on your disk, metadata in Postgres. Connect media servers, wire developer tools, and keep optional services on your terms—no cloud account required."
      stats={[
        {
          label: "Connectors",
          value: integrationsQuery.isLoading ? "…" : list.length.toLocaleString(),
        },
        {
          label: "Active",
          value: integrationsQuery.isLoading ? "…" : connected.toLocaleString(),
        },
        {
          label: "Webhooks",
          value: "Developer",
        },
        {
          label: "Tunnel",
          value: "Settings",
        },
      ]}
    />
  )
}
