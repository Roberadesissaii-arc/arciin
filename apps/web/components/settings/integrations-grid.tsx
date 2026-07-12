"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  BookOpen,
  Cable,
  CheckCircle2,
  PackagePlus,
  Plug,
  Server,
  Sparkles,
  Webhook,
  XCircle,
} from "lucide-react"

import { IntegrationCard } from "@/components/settings/integration-card"
import { IntegrationComingSoonCard } from "@/components/settings/integration-coming-soon-card"
import { IntegrationToolCard } from "@/components/settings/integration-tool-card"
import { MobileAppIntegrationCard } from "@/components/settings/mobile-app-integration-card"
import {
  DEFAULT_JELLYFIN_INTEGRATION,
  DEFAULT_PLEX_INTEGRATION,
  JELLYFIN_INTEGRATION_ID,
  PLEX_INTEGRATION_ID,
} from "@/lib/api/integrations"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getIntegrations } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

const FLOW_STEPS = [
  {
    title: "Libraries",
    body: "Files on disk under your storage root. Libraries and folders are the source of truth.",
    icon: Sparkles,
  },
  {
    title: "Connectors",
    body: "Plex and Jellyfin read the same folder tree. Enable a connector to wire it up.",
    icon: Plug,
  },
  {
    title: "API & Webhooks",
    body: "API keys and webhooks let external apps push events or read data without connector rows.",
    icon: Cable,
  },
] as const

function IntegrationFlow() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/[0.03]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-5 py-4">
        <PackagePlus className="size-4 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">How integrations fit</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Local-first flow from disk to optional connectors</p>
        </div>
        <Button asChild variant="outline" size="sm" className="border-border text-xs">
          <Link href="/docs">
            <BookOpen className="mr-1.5 size-3.5" />
            Docs
          </Link>
        </Button>
      </div>
      <ol className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
        {FLOW_STEPS.map((step, i) => {
          const Icon = step.icon
          return (
            <li
              key={step.title}
              className="relative flex h-full min-h-[8.5rem] flex-col rounded-xl border border-border bg-muted/15 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <Icon className="size-4 text-primary" aria-hidden />
              </div>
              <p className="text-[13px] font-semibold text-foreground">{step.title}</p>
              <p className="mt-1 flex-1 text-[12px] leading-snug text-muted-foreground">{step.body}</p>
              {i < FLOW_STEPS.length - 1 ? (
                <span
                  className="pointer-events-none absolute -right-2 top-1/2 hidden -translate-y-1/2 text-muted-foreground/35 lg:block"
                  aria-hidden
                >
                  <ArrowRight className="size-4" />
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function SectionHeader({
  title,
  description,
  badge,
}: {
  title: string
  description?: string
  badge?: string
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {badge ? (
        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </div>
  )
}

export function IntegrationsGrid() {
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations,
    queryFn: ({ signal }) => getIntegrations(signal),
  })

  if (integrationsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="hidden h-80 rounded-2xl xl:block" />
        </div>
      </div>
    )
  }

  if (integrationsQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/25 bg-red-50 p-4 text-sm text-red-800">
        {integrationsQuery.error instanceof Error
          ? integrationsQuery.error.message
          : "Could not load integrations."}
      </div>
    )
  }

  const integrations = integrationsQuery.data ?? []
  const sorted = [...integrations].sort((a, b) => {
    if (a.type === "PLEX" && b.type !== "PLEX") return -1
    if (b.type === "PLEX" && a.type !== "PLEX") return 1
    return a.name.localeCompare(b.name)
  })

  const plex = sorted.find((i) => i.type === "PLEX" || i.id === PLEX_INTEGRATION_ID) ?? DEFAULT_PLEX_INTEGRATION
  const jellyfin = sorted.find((i) => i.id === JELLYFIN_INTEGRATION_ID) ?? DEFAULT_JELLYFIN_INTEGRATION
  const others = sorted.filter(
    (i) => i.type !== "PLEX" && i.id !== PLEX_INTEGRATION_ID && i.id !== JELLYFIN_INTEGRATION_ID,
  )

  const connectedCount = [plex, jellyfin, ...others].filter((i) => i.enabled).length
  const totalCount = [plex, jellyfin, ...others].length

  return (
    <div className="space-y-8">
      <IntegrationFlow />

      <MobileAppIntegrationCard />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium shadow-sm">
          {connectedCount > 0 ? (
            <CheckCircle2 className="size-3.5 text-emerald-600" />
          ) : (
            <XCircle className="size-3.5 text-zinc-400" />
          )}
          <span className="text-foreground">
            {connectedCount} of {totalCount} active
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Toggle <span className="font-medium text-foreground">Use … folders</span> on a card to enable a connector.
          Setup guides are in{" "}
          <Link href="/docs#integrations-overview" className="font-medium text-primary hover:underline">
            Docs
          </Link>
          .
        </p>
      </div>

      <section aria-labelledby="integrations-connectors">
        <SectionHeader
          title="Media server connectors"
          description="Equal-height cards — enable, repair folders, and open library paths"
          badge={`${totalCount + 1} slots`}
        />
        <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3 [&>*]:h-full [&>*]:min-h-0">
          <IntegrationCard integration={plex} />
          <IntegrationCard integration={jellyfin} />
          <IntegrationComingSoonCard />
          {others.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      </section>

      <section aria-labelledby="integrations-tools">
        <SectionHeader
          title="Developer tools"
          description="HTTP callbacks and API access without a connector row"
        />
        <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationToolCard
            href="/developer/webhooks"
            icon={Webhook}
            title="Webhooks"
            description="Signed POST deliveries for upload and asset events"
          />
          <IntegrationToolCard
            href="/api-keys"
            icon={Server}
            title="API Keys"
            description="Bearer tokens for external scripts and agents"
          />
          <IntegrationToolCard
            href="/docs"
            icon={BookOpen}
            title="Documentation"
            description="REST API, Socket.IO events, and install guides"
          />
        </div>
      </section>
    </div>
  )
}
