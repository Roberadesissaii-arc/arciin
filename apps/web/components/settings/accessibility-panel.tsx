"use client"

import { Accessibility } from "lucide-react"
import { FONT_SIZE_OPTIONS } from "@arciin/shared"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { AccessibilityLivePreview } from "@/components/settings/accessibility-live-preview"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"

export function AccessibilityPanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.accessibility
  const busy = mutation.isPending

  if (query.isLoading) {
    return <Skeleton className="h-64 w-full rounded-2xl" />
  }

  if (query.isError || !prefs) {
    const message =
      query.error instanceof Error ? query.error.message : "Could not load accessibility preferences."
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
        <p className="font-medium">{message}</p>
        <p className="mt-1 text-[12px] text-red-700/90">
          Run <code className="rounded bg-red-100 px-1">pnpm db:deploy</code> then restart{" "}
          <code className="rounded bg-red-100 px-1">pnpm dev:api</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AccessibilityLivePreview />
      <Card className="border-border bg-card shadow-none">
        <CardHeader>
          <SectionHeader
            icon={Accessibility}
            title="Accessibility"
            description="Readable text, contrast, motion, and keyboard focus for your account."
          />
        </CardHeader>
        <CardContent>
          <SettingRow label="Font size" hint="Base UI text size in the dashboard">
            <div className="flex flex-wrap justify-end gap-1">
              {FONT_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ accessibility: { fontSize: size } }, `Font size: ${size}`)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                    prefs.fontSize === size
                      ? "bg-primary/15 text-primary ring-1 ring-primary/35"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80",
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="Reduce animations" hint="Minimize motion across the interface">
            <PillSwitch
              on={prefs.reduceAnimations}
              disabled={busy}
              onChange={() =>
                patch(
                  { accessibility: { reduceAnimations: !prefs.reduceAnimations } },
                  prefs.reduceAnimations ? "Reduced motion off" : "Reduced motion on",
                )
              }
            />
          </SettingRow>
          <SettingRow label="High contrast" hint="Stronger borders and text contrast">
            <PillSwitch
              on={prefs.highContrast}
              disabled={busy}
              onChange={() =>
                patch(
                  { accessibility: { highContrast: !prefs.highContrast } },
                  prefs.highContrast ? "High contrast off" : "High contrast on",
                )
              }
            />
          </SettingRow>
          <SettingRow label="Keyboard navigation" hint="Enhanced focus rings and shortcut hints">
            <PillSwitch
              on={prefs.keyboardNav}
              disabled={busy}
              onChange={() =>
                patch(
                  { accessibility: { keyboardNav: !prefs.keyboardNav } },
                  prefs.keyboardNav ? "Keyboard nav off" : "Keyboard nav on",
                )
              }
            />
          </SettingRow>
        </CardContent>
      </Card>

      <p className="px-1 text-[12px] text-zinc-500">
        Font size zooms the dashboard content. Reduce animations limits motion (also follows OS reduce
        motion). High contrast thickens borders. Keyboard navigation strengthens Tab focus rings.
      </p>
    </div>
  )
}
