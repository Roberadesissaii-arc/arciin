"use client"

import { LayoutGrid } from "lucide-react"

import { DocumentThumbnailsSettings } from "@/components/settings/document-thumbnails-settings"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SettingsSelect } from "@/components/settings/settings-select"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"
import { UI_RADIUS_OPTIONS, type UiRadius } from "@arciin/shared"

const RADIUS_LABELS: Record<UiRadius, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
  sharp: "Sharp",
}

export function PersonalizationGeneralPanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.appearance
  const busy = mutation.isPending

  if (query.isLoading) {
    return <Skeleton className="h-48 w-full rounded-xl" />
  }

  if (query.isError || !prefs) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
        {query.error instanceof Error ? query.error.message : "Could not load preferences."}
      </div>
    )
  }

  return (
    <div className="space-y-5">
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="pb-3">
        <SectionHeader
          icon={LayoutGrid}
          title="General layout"
          description="Spacing, motion, and corner radius across the dashboard."
        />
      </CardHeader>
      <CardContent>
        <SettingRow label="Compact view" hint="Tighter gaps and padding">
          <PillSwitch
            on={prefs.compactView}
            disabled={busy}
            onChange={() =>
              patch(
                { appearance: { compactView: !prefs.compactView } },
                prefs.compactView ? "Compact view off" : "Compact view on",
              )
            }
          />
        </SettingRow>
        <SettingRow label="Card hover motion" hint="Border feedback on cards">
          <PillSwitch
            on={prefs.animatedCards}
            disabled={busy}
            onChange={() =>
              patch(
                { appearance: { animatedCards: !prefs.animatedCards } },
                prefs.animatedCards ? "Card motion off" : "Card motion on",
              )
            }
          />
        </SettingRow>
        <SettingRow label="Corner radius" hint="Buttons, inputs, and cards">
          <SettingsSelect
            aria-label="Corner radius"
            value={prefs.uiRadius}
            disabled={busy}
            options={UI_RADIUS_OPTIONS.map((v) => ({ value: v, label: RADIUS_LABELS[v] }))}
            onValueChange={(uiRadius) =>
              patch({ appearance: { uiRadius } }, `Corners: ${RADIUS_LABELS[uiRadius]}`)
            }
          />
        </SettingRow>
      </CardContent>
    </Card>
    <DocumentThumbnailsSettings />
    </div>
  )
}
