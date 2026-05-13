"use client"

import { useQuery } from "@tanstack/react-query"

import { IntegrationCard } from "@/components/settings/integration-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getIntegrations } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { IntegrationSummary } from "@/lib/types/models"

export function IntegrationsGrid() {
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations,
    queryFn: ({ signal }) => getIntegrations(signal),
  })

  if (integrationsQuery.isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    )
  }

  if (integrationsQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
        {integrationsQuery.error instanceof Error
          ? integrationsQuery.error.message
          : "Could not load integrations."}
      </div>
    )
  }

  const integrations = integrationsQuery.data ?? []

  const fallbackIntegrations: IntegrationSummary[] = [
    {
      id: "future-s3",
      type: "S3",
      name: "S3-compatible storage",
      enabled: false,
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "future-webhooks",
      type: "WEBHOOK",
      name: "Webhooks",
      enabled: false,
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {[...integrations, ...fallbackIntegrations].map((integration) => (
        <IntegrationCard
          key={integration.id}
          integration={integration}
          cta={
            integration.type === "PLEX" ? (
              <Button variant="outline" className="border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]">
                Configure Plex placeholder
              </Button>
            ) : undefined
          }
        />
      ))}
    </div>
  )
}
