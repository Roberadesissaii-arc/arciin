"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2, MonitorPlay } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MediaConnectorCardFooter } from "@/components/settings/media-connector-card-footer"
import {
  MediaConnectorHealthBadge,
  MediaConnectorHealthNotice,
} from "@/components/settings/media-connector-health"
import { getPlexStatus, setupPlexFolders, updatePlexIntegration } from "@/lib/api/integrations"
import { queryKeys } from "@/lib/api/query-keys"
import type { IntegrationSummary } from "@/lib/types/models"
import {
  MEDIA_CONNECTOR_HEADER_BLURB,
  MEDIA_CONNECTOR_PLEX_SCAN_BLURB,
  MediaConnectorToggleRow,
} from "@/components/settings/media-connector-toggle-row"

export function PlexIntegrationCard({ integration }: { integration: IntegrationSummary }) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: queryKeys.plexStatus,
    queryFn: ({ signal }) => getPlexStatus(signal),
  })

  const invalidatePlex = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.plexStatus }),
      queryClient.invalidateQueries({ queryKey: ["folders"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
    ])
  }

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => updatePlexIntegration({ enabled }),
    onSuccess: async (_data, enabled) => {
      await invalidatePlex()
      if (enabled) {
        const status = await queryClient.fetchQuery({
          queryKey: queryKeys.plexStatus,
          queryFn: ({ signal }) => getPlexStatus(signal),
        })
        const ready = status.health.state === "healthy"
        toast.success(ready ? "Plex enabled." : "Plex enabled, with warnings.", {
          description: ready
            ? "Plex folders are set up in Videos, Images, and Music — new uploads will use them."
            : "Some folders could not be verified. Try “Repair folders” below.",
        })
      } else {
        toast.success("Plex disabled.", {
          description: "Uploads no longer auto-route to Plex folders (existing folders stay).",
        })
      }
    },
    onError: (e: Error) =>
      toast.error("Could not update Plex", { description: e.message || "Try again in a moment." }),
  })

  const repairMutation = useMutation({
    mutationFn: setupPlexFolders,
    onSuccess: async (data) => {
      await invalidatePlex()
      toast.success(
        data.created > 0 ? `Created ${data.created} missing Plex folder(s).` : "Folders already present.",
        {
          description:
            data.created > 0
              ? "New folders are ready for Plex to scan."
              : "Plex folders are already present in all libraries.",
        },
      )
    },
    onError: (e: Error) =>
      toast.error("Could not repair Plex folders", {
        description: e.message || "Try again in a moment.",
      }),
  })

  const enabled = integration.enabled
  const folders = statusQuery.data?.folders ?? []
  const mirrorRootHint = statusQuery.data?.mirrorRootHint
  const busy = toggleMutation.isPending || repairMutation.isPending

  return (
    <Card className="flex h-full min-h-0 flex-col border-border bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <MonitorPlay className="size-5 shrink-0 text-zinc-500" aria-hidden />
              <CardTitle className="text-foreground">{integration.name}</CardTitle>
            </div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {integration.type}
            </p>
            <CardDescription className="min-h-[3.25rem] text-zinc-600">
              {MEDIA_CONNECTOR_HEADER_BLURB}
            </CardDescription>
          </div>
          <MediaConnectorHealthBadge
            health={statusQuery.data?.health}
            loading={statusQuery.isLoading}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
        <MediaConnectorToggleRow
          label="Use Plex folders"
          checked={enabled}
          disabled={busy}
          onChange={(v) => toggleMutation.mutate(v)}
        />

        {statusQuery.isError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-foreground"
            role="alert"
          >
            Could not read Plex status from the server. Try again in a moment.
          </div>
        ) : (
          <MediaConnectorHealthNotice
            health={statusQuery.data?.health}
            onRepair={() => repairMutation.mutate()}
            repairing={repairMutation.isPending}
            disabled={busy}
          />
        )}

        {statusQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading folder status…</p>
        ) : folders.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Plex folders</p>
            <ul className="space-y-2">
              {folders.map((f) => (
                <li
                  key={f.librarySlug}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-sm"
                >
                  <span className="font-medium text-foreground">{f.libraryName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{f.folderPath}</span>
                  {f.ready && f.onDisk && f.folderId ? (
                    <Button
                      asChild
                      size="sm"
                      className="h-8 border-0 bg-primary px-3 font-semibold text-white shadow-none hover:bg-primary/90"
                    >
                      <Link href={`/${f.librarySlug}/plex`}>
                        Open
                        <ExternalLink className="ml-1.5 size-3.5 opacity-90" />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs font-medium text-warning">
                      {f.ready ? "Missing on disk" : "Missing"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {enabled && mirrorRootHint ? (
          <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Plex library folder on this server</p>
            <p className="mt-1 font-mono text-[11px] break-all text-zinc-600">{mirrorRootHint}</p>
            <p className="mt-2">{MEDIA_CONNECTOR_PLEX_SCAN_BLURB}</p>
          </div>
        ) : null}
        </div>

        <MediaConnectorCardFooter
          enabled={enabled}
          displayName={integration.name}
          hasReadyFolders={folders.some((f) => f.ready)}
        />
      </CardContent>
    </Card>
  )
}
