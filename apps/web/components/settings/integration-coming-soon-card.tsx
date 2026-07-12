import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function IntegrationComingSoonCard() {
  return (
    <Card className="flex h-full min-h-0 flex-col border-dashed border-border/90 bg-muted/15">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Plus className="size-5 shrink-0 text-zinc-400" aria-hidden />
              <CardTitle className="text-foreground">More connectors</CardTitle>
            </div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Coming soon
            </p>
            <CardDescription className="min-h-[3.25rem] text-zinc-600">
              Additional media servers and storage connectors will use the same card layout—equal height,
              one toggle, folder status, and docs link.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 border-border bg-muted/40 text-zinc-500">
            Planned
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-3.5">
            <p className="text-[13px] font-semibold text-foreground">Same layout every time</p>
            <p className="mt-1 min-h-[4.25rem] text-[12px] leading-snug text-muted-foreground">
              New integrations slot into the grid without reshaping Plex or Jellyfin. Enable, repair folders,
              and open library paths from one consistent card.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Examples on the roadmap</p>
            <p className="mt-1">Emby, Kodi sync, S3 tiering, and custom instance modules.</p>
          </div>
        </div>
        <p className="mt-auto min-h-[2.75rem] shrink-0 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Placeholder.</span> Request a connector in support or
          track progress in Docs as connectors ship.
        </p>
      </CardContent>
    </Card>
  )
}
