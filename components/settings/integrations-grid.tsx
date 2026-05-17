"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  BookOpen,
  Cable,
  CheckCircle2,
  ChevronRight,
  Plug,
  Server,
  Sparkles,
  Webhook,
  XCircle,
} from "lucide-react"

import { IntegrationCard } from "@/components/settings/integration-card"
import {
  DEFAULT_JELLYFIN_INTEGRATION,
  DEFAULT_PLEX_INTEGRATION,
  JELLYFIN_INTEGRATION_ID,
  PLEX_INTEGRATION_ID,
} from "@/lib/api/integrations"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
    <div className="rounded-2xl border border-border bg-gradient-to-b from-muted/30 to-card p-5 shadow-sm ring-1 ring-black/[0.03] sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">How it works</p>
          <p className="mt-1 text-base font-semibold text-foreground">Arciin stays local-first</p>
        </div>
        <Button asChild variant="outline" size="sm" className="border-border text-xs">
          <Link href="/docs">
            <BookOpen className="mr-1.5 size-3.5" />
            Full docs
          </Link>
        </Button>
      </div>
      <ol className="grid gap-3 lg:grid-cols-3">
        {FLOW_STEPS.map((step, i) => {
          const Icon = step.icon
          return (
            <li
              key={step.title}
              className="relative flex flex-col rounded-xl border border-border bg-card/90 p-4 shadow-sm"
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
                  className="pointer-events-none absolute -right-2 top-1/2 hidden -translate-y-1/2 text-muted-foreground/40 lg:block"
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

function QuickLinkCard({
  title,
  description,
  href,
  icon: Icon,
  variant = "default",
}: {
  title: string
  description: string
  href: string
  icon: React.ElementType
  variant?: "default" | "primary"
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/40"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="text-[12px] leading-snug text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </Link>
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
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
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

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[12px] font-medium">
          {connectedCount > 0 ? (
            <CheckCircle2 className="size-3.5 text-emerald-600" />
          ) : (
            <XCircle className="size-3.5 text-zinc-400" />
          )}
          <span className="text-foreground">{connectedCount} of {totalCount} active</span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Toggle <span className="font-medium text-foreground">Use … folders</span> on a card to enable a connector.
          Setup guides are in{" "}
          <Link href="/docs#plex-media-server" className="text-primary hover:underline">Docs</Link>.
        </p>
      </div>

      {/* Connector cards */}
      <section aria-labelledby="integrations-connectors">
        <h2 id="integrations-connectors" className="mb-3 text-sm font-semibold tracking-tight text-foreground">
          Media server connectors
        </h2>
        <div className="space-y-4">
          <div className="grid items-stretch gap-4 lg:grid-cols-2 [&>*]:h-full [&>*]:min-h-0">
            <IntegrationCard integration={plex} />
            <IntegrationCard integration={jellyfin} />
          </div>
          {others.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {others.map((integration) => (
                <IntegrationCard key={integration.id} integration={integration} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Quick links — no heavy documentation panels */}
      <section aria-labelledby="integrations-tools">
        <h2 id="integrations-tools" className="mb-3 text-sm font-semibold tracking-tight text-foreground">
          Developer tools
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLinkCard
            href="/developer/webhooks"
            icon={Webhook}
            title="Webhooks"
            description="Signed POST deliveries for upload and asset events"
          />
          <QuickLinkCard
            href="/api-keys"
            icon={Server}
            title="API Keys"
            description="Bearer tokens for external scripts and agents"
          />
          <QuickLinkCard
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
