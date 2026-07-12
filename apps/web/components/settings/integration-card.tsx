import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { JELLYFIN_INTEGRATION_ID } from "@/lib/api/integrations"
import { JellyfinIntegrationCard } from "@/components/settings/jellyfin-integration-card"
import { PlexIntegrationCard } from "@/components/settings/plex-integration-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { IntegrationSummary } from "@/lib/types/models"

function typeBlurb(type: IntegrationSummary["type"]): string {
  switch (type) {
    case "PLEX":
      return "Plex reads your disk through its own server. Arciin keeps files where you put them."
    case "S3":
      return "When enabled, this connector will mirror or tier objects to S3-compatible storage. Not wired in the worker yet."
    case "WEBHOOK":
      return "Outbound webhooks are configured under Developer → Webhooks, not as a row here. This type is reserved if we ever mirror webhook config into integrations."
    case "CUSTOM":
      return "Custom integration slot for future instance-specific modules."
    default:
      return "Integration metadata from the database."
  }
}

function typeHint(type: IntegrationSummary["type"]): string {
  switch (type) {
    case "S3":
      return "Reserved for object-storage replication jobs."
    case "WEBHOOK":
      return "Use the Webhooks page for HTTP callbacks."
    case "CUSTOM":
      return "Reserved for extensions."
    default:
      return ""
  }
}

export function IntegrationCard({ integration }: { integration: IntegrationSummary }) {
  if (integration.type === "PLEX") {
    return <PlexIntegrationCard integration={integration} />
  }

  if (integration.id === JELLYFIN_INTEGRATION_ID) {
    return <JellyfinIntegrationCard integration={integration} />
  }

  return (
    <Card className="flex h-full min-h-0 flex-col border-border bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-foreground">{integration.name}</CardTitle>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {integration.type}
            </p>
            <CardDescription className="text-zinc-600">{typeBlurb(integration.type)}</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              integration.enabled
                ? "shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                : "shrink-0 border-border bg-muted/40 text-zinc-600"
            }
          >
            {integration.enabled ? "Connected" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {typeHint(integration.type) ? (
          <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-zinc-700">
            {typeHint(integration.type)}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {integration.type === "WEBHOOK" ? (
            <Button asChild variant="outline" className="border-border">
              <Link href="/developer/webhooks">
                Open Webhooks
                <ExternalLink className="ml-2 size-3.5 opacity-70" aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" className="border-border" disabled>
              Coming later
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
