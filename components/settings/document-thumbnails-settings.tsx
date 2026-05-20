"use client"

import { FileImage } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  PillSwitch,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"

export function DocumentThumbnailsSettings() {
  const { query, patch, mutation } = useUserPreferencesSettings()
  const enabled = query.data?.media.documentThumbnails ?? false

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <FileImage className="size-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-foreground">Document thumbnails</CardTitle>
            <CardDescription className="text-zinc-600">
              Technical option. Off by default. When enabled, Arciin renders the first page of PDFs
              as preview images in your libraries.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SettingRow
          label="Generate PDF previews"
          hint="Requires ffmpeg on the server. Existing PDFs are queued when you turn this on."
        >
          <PillSwitch
            on={enabled}
            disabled={query.isLoading || mutation.isPending}
            onChange={() =>
              patch(
                { media: { documentThumbnails: !enabled } },
                !enabled ? "PDF previews enabled" : "PDF previews disabled",
              )
            }
          />
        </SettingRow>
      </CardContent>
    </Card>
  )
}
