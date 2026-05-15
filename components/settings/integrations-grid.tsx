"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Cable,
  Globe,
  Plug,
  Sparkles,
  Webhook,
} from "lucide-react"

import { IntegrationCard } from "@/components/settings/integration-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { getIntegrations } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="mb-1 text-sm font-semibold tracking-tight text-foreground"
    >
      {children}
    </h2>
  )
}

function SectionLead({ children }: { children: React.ReactNode }) {
  return <p className="mb-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{children}</p>
}

const FLOW_STEPS = [
  {
    title: "Libraries",
    body: "Files live on disk under your storage root. Libraries and folders are the source of truth for media layout.",
    icon: Sparkles,
  },
  {
    title: "Connectors",
    body: "Optional bridges (Plex today, more later) read the same tree. Nothing moves until you wire a real connector.",
    icon: Plug,
  },
  {
    title: "HTTP & API",
    body: "Webhooks and API keys let other apps push events or metadata without duplicating connector rows here.",
    icon: Cable,
  },
  {
    title: "Realtime",
    body: "Socket.IO streams upload and job progress to the dashboard—same channels your automations can subscribe to from Docs.",
    icon: Boxes,
  },
] as const

function IntegrationFlow() {
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-muted/30 to-card p-5 shadow-sm ring-1 ring-black/[0.03] sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Flow</p>
          <p className="mt-1 text-base font-semibold text-foreground">How integrations sit in Arciin</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">
          <Link href="/settings/domain" className="text-primary hover:underline">
            Domain
          </Link>
          <span className="text-muted-foreground/50" aria-hidden>
            ·
          </span>
          <Link href="/developer/web-sockets" className="text-primary hover:underline">
            WebSockets
          </Link>
        </div>
      </div>
      <ol className="grid gap-3 lg:grid-cols-4">
        {FLOW_STEPS.map((step, i) => {
          const Icon = step.icon
          return (
            <li
              key={step.title}
              className="relative flex min-h-[140px] flex-col rounded-xl border border-border bg-card/90 p-4 shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <Icon className="size-4 text-primary" aria-hidden />
              </div>
              <p className="text-[13px] font-semibold text-foreground">{step.title}</p>
              <p className="mt-1.5 flex-1 text-[12px] leading-snug text-muted-foreground">{step.body}</p>
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

function PlannedConnectorCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card className="border border-dashed border-primary/25 bg-gradient-to-br from-primary/[0.06] to-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Plug className="size-5 shrink-0 text-primary" aria-hidden />
          <CardTitle className="text-base text-foreground">{title}</CardTitle>
        </div>
        <CardDescription className="text-muted-foreground">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          Planned
        </span>
      </CardContent>
    </Card>
  )
}

export function IntegrationsGrid() {
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations,
    queryFn: ({ signal }) => getIntegrations(signal),
  })

  if (integrationsQuery.isLoading) {
    return (
      <div className="space-y-10">
        <Skeleton className="h-48 rounded-2xl" />
        <div>
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
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

  return (
    <div className="space-y-12">
      <IntegrationFlow />

      <section aria-labelledby="integrations-connectors">
        <SectionTitle id="integrations-connectors">Connectors</SectionTitle>
        <SectionLead>
          Rows below are persisted in the <span className="font-mono text-foreground">integrations</span> table.
          Plex is a placeholder today: organize folders first, then a future release can attach server credentials and
          health checks—without changing where files live on disk.
        </SectionLead>
        {sorted.length === 0 ? (
          <Empty className="rounded-2xl border border-dashed border-border bg-muted/20">
            <EmptyHeader>
              <EmptyTitle>No integrations yet</EmptyTitle>
              <EmptyDescription>
                Run <span className="font-mono text-foreground">pnpm db:seed</span> after setup so the default Plex
                placeholder exists.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {sorted.map((integration) => (
              <IntegrationCard key={integration.id} integration={integration} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="integrations-developer">
        <SectionTitle id="integrations-developer">Developer &amp; automation</SectionTitle>
        <SectionLead>
          First-class pages—same Socket event names you will see in the dashboard. Use these when an external worker or
          AI agent should react without a database-backed connector row.
        </SectionLead>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Webhook className="size-5 text-primary" aria-hidden />
                <CardTitle className="text-foreground">Webhooks</CardTitle>
              </div>
              <CardDescription className="text-muted-foreground">
                Signed HTTPS POST deliveries for the same event families the UI subscribes to. Create endpoints, pick
                event types, and inspect delivery logs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/developer/webhooks">Open Webhooks</Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="size-5 text-primary" aria-hidden />
                <CardTitle className="text-foreground">Documentation</CardTitle>
              </div>
              <CardDescription className="text-muted-foreground">
                Base URLs, session cookies, bearer API keys, and Socket.IO event names for this instance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="border-border">
                <Link href="/docs">Open Docs</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="integrations-roadmap">
        <SectionTitle id="integrations-roadmap">Roadmap</SectionTitle>
        <SectionLead>
          Upcoming connector slots—no fake enabled toggles until the worker and API are wired. Icons match the accent
          used above so the page reads as one system.
        </SectionLead>
        <div className="grid gap-4 lg:grid-cols-3">
          <PlannedConnectorCard
            title="S3-compatible storage"
            description="Optional replication of object storage to S3, MinIO, or R2. Path-safe keys and soft deletes will match Arciin’s local model."
          />
          <PlannedConnectorCard
            title="Additional media targets"
            description="More self-hosted targets (Jellyfin hints, backup sinks) without requiring a cloud account—same library layout rules."
          />
          <Card className="flex flex-col border border-dashed border-primary/25 bg-gradient-to-br from-primary/[0.06] to-card">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Boxes className="size-5 shrink-0 text-primary" aria-hidden />
                <CardTitle className="text-base text-foreground">Worker &amp; jobs</CardTitle>
              </div>
              <CardDescription className="text-muted-foreground">
                Thumbnails, metadata extraction, and future connector sync run out-of-band. Monitor queue depth and
                failures here as integrations grow.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button asChild variant="outline" className="border-primary/30 text-primary hover:bg-primary/10">
                <Link href="/jobs">Open Jobs</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="integrations-remote">
        <SectionTitle id="integrations-remote">Reach this instance from the internet</SectionTitle>
        <SectionLead>
          Default posture is LAN-only. When you need HTTPS on a real hostname—or a Cloudflare Tunnel without opening
          ports—configure it under Settings. Quick tunnels can give a random URL per run; named tunnels stay stable.
        </SectionLead>
        <Card className="overflow-hidden border-border bg-card">
          <CardHeader className="border-b border-border bg-muted/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12">
                  <Globe className="size-5 text-primary" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-foreground">Domain and WebSockets</CardTitle>
                  <CardDescription className="mt-1 text-muted-foreground">
                    Set the public URL under Domain; choose tunnel or reverse proxy under Developer → WebSockets. Use
                    both when you have a stable hostname and a path for traffic to reach the host.
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" className="border-border">
                  <Link href="/settings/domain">Domain</Link>
                </Button>
                <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Link href="/developer/web-sockets">WebSockets</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <ul className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <li className="flex gap-2 rounded-lg border border-border/80 bg-muted/15 px-3 py-2.5">
                <span className="font-semibold text-primary">①</span>
                <span>
                  <span className="font-medium text-foreground">Tunnel:</span> encrypted path to localhost—good for
                  laptops or hosts without a static IP.
                </span>
              </li>
              <li className="flex gap-2 rounded-lg border border-border/80 bg-muted/15 px-3 py-2.5">
                <span className="font-semibold text-primary">②</span>
                <span>
                  <span className="font-medium text-foreground">Proxy:</span> terminate TLS in front of Arciin and set
                  <span className="font-mono text-foreground"> X-Forwarded-*</span> headers your app trusts.
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
