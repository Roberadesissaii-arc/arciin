"use client"

import { Palette } from "lucide-react"

import { AccentColorSelect } from "@/components/settings/accent-color-select"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"
import { getAccentLabel } from "@arciin/shared"

export function PersonalizationThemePanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.appearance
  const busy = mutation.isPending

  if (query.isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />
  }

  if (query.isError || !prefs) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
        {query.error instanceof Error ? query.error.message : "Could not load preferences."}
      </div>
    )
  }

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="pb-3">
        <SectionHeader
          icon={Palette}
          title="Accent color"
          description="Buttons, links, active navigation, folder highlights, and toggles follow this color."
        />
      </CardHeader>
      <CardContent>
        <SettingRow label="Color" hint="Saved to your account on this instance">
          <AccentColorSelect
            value={prefs.accentColor}
            disabled={busy}
            onChange={(hex) => patch({ appearance: { accentColor: hex } }, `Accent: ${getAccentLabel(hex)}`)}
          />
        </SettingRow>
      </CardContent>
    </Card>
  )
}
