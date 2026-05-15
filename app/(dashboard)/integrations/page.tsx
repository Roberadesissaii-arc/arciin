"use client"

import { useQuery } from "@tanstack/react-query"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntegrationsGrid } from "@/components/settings/integrations-grid"
import { getIntegrations } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

export default function IntegrationsPage() {
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations,
    queryFn: ({ signal }) => getIntegrations(signal),
  })

  const list = integrationsQuery.data ?? []
  const connected = list.filter((i) => i.enabled).length

  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Integrations"
        subtitle="Connectors · automation · same self-hosted instance"
        description="Arciin stays local-first: files on your disk, metadata in Postgres. This hub explains how optional connectors, webhooks, API keys, and workers fit together—then lists real connector rows from the database (Plex placeholder today). When you need the internet to reach your box, use WebSockets for Cloudflare Tunnel or a reverse proxy."
        stats={[
          {
            label: "Connectors in DB",
            value: integrationsQuery.isLoading ? "…" : list.length.toLocaleString(),
          },
          {
            label: "Connected",
            value: integrationsQuery.isLoading ? "…" : connected.toLocaleString(),
          },
          {
            label: "Webhooks",
            value: "Own page",
          },
          {
            label: "WebSockets",
            value: "Settings",
          },
        ]}
      />
      <IntegrationsGrid />
    </div>
  )
}
