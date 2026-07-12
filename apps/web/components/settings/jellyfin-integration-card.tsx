"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2, Film } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MediaConnectorCardFooter } from "@/components/settings/media-connector-card-footer"
import { getJellyfinStatus, setupJellyfinFolders, updateJellyfinIntegration } from "@/lib/api/integrations"
import { queryKeys } from "@/lib/api/query-keys"
import type { IntegrationSummary } from "@/lib/types/models"
import {
  MEDIA_CONNECTOR_HEADER_BLURB,
  MediaConnectorToggleRow,
} from "@/components/settings/media-connector-toggle-row"

export function JellyfinIntegrationCard({ integration }: { integration: IntegrationSummary }) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: queryKeys.jellyfinStatus,
    queryFn: ({ signal }) => getJellyfinStatus(signal),
  })

  const invalidateJellyfin = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.jellyfinStatus }),
      queryClient.invalidateQueries({ queryKey: ["folders"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
    ])
  }

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => updateJellyfinIntegration({ enabled }),
    onSuccess: async (_data, enabled) => {
      await invalidateJellyfin()
      if (enabled) {
        const status = await queryClient.fetchQuery({
          queryKey: queryKeys.jellyfinStatus,
          queryFn: ({ signal }) => getJellyfinStatus(signal),
        })
        const ready = status.folders.every((f) => f.ready)
        toast.success(ready ? "Jellyfin enabled." : "Jellyfin enabled, with warnings.", {
          description: ready
            ? "Jellyfin folders are set up in Videos, Images, and Music — new uploads will use them."
            : "Some folders could not be verified. Try “Repair folders” below.",
        })
      } else {
        toast.success("Jellyfin disabled.", {
          description: "Uploads no longer auto-route to Jellyfin folders (existing folders stay).",
        })
      }
    },
    onError: (e: Error) =>
      toast.error("Could not update Jellyfin", { description: e.message || "Try again in a moment." }),
  })

  const repairMutation = useMutation({
    mutationFn: setupJellyfinFolders,
    onSuccess: async (data) => {
      await invalidateJellyfin()
      toast.success(
        data.created > 0
          ? `Created ${data.created} missing Jellyfin folder(s).`
          : "Folders already present.",
        {
          description:
            data.created > 0
              ? "New folders are ready for Jellyfin to scan."
              : "Jellyfin folders are already present in all libraries.",
        },
      )
    },
    onError: (e: Error) =>
      toast.error("Could not repair Jellyfin folders", {
        description: e.message || "Try again in a moment.",
      }),
  })

  const enabled = integration.enabled
  const folders = statusQuery.data?.folders ?? []
  const allReady = folders.length > 0 && folders.every((f) => f.ready)
  const busy = toggleMutation.isPending || repairMutation.isPending

  return (
    <Card className="flex h-full min-h-0 flex-col border-border bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Film className="size-5 shrink-0 text-zinc-500" aria-hidden />
              <CardTitle className="text-foreground">{integration.name}</CardTitle>
            </div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {integration.type}
            </p>
            <CardDescription className="min-h-[3.25rem] text-zinc-600">
              {MEDIA_CONNECTOR_HEADER_BLURB}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              enabled
                ? "shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                : "shrink-0 border-border bg-muted/40 text-zinc-600"
            }
          >
            {enabled ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
        <MediaConnectorToggleRow
          label="Use Jellyfin folders"
          checked={enabled}
          disabled={busy}
          onChange={(v) => toggleMutation.mutate(v)}
        />

        {enabled && !allReady && !statusQuery.isLoading ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-950">
            <p className="font-medium">Some Jellyfin folders are missing.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 border-amber-600/30 bg-white"
              disabled={busy}
              onClick={() => repairMutation.mutate()}
            >
              {repairMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Repairing…
                </>
              ) : (
                "Repair folders"
              )}
            </Button>
          </div>
        ) : null}

        {statusQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading folder status…</p>
        ) : folders.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Jellyfin folders</p>
            <ul className="space-y-2">
              {folders.map((f) => (
                <li
                  key={f.librarySlug}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-sm"
                >
                  <span className="font-medium text-foreground">{f.libraryName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{f.folderPath}</span>
                  {f.ready && f.folderId ? (
                    <Button asChild variant="ghost" size="sm" className="h-8 text-primary">
                      <Link href={`/${f.librarySlug}/jellyfin`}>
                        Open
                        <ExternalLink className="ml-1.5 size-3.5 opacity-70" />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-amber-700">Missing</span>
                  )}
                </li>
              ))}
            </ul>
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
