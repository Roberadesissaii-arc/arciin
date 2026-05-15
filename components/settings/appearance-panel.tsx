"use client"

import { MessageSquare, Palette } from "lucide-react"
import { toast } from "sonner"
import {
  TOAST_POSITIONS,
  TOAST_STYLE_META,
  UI_RADIUS_OPTIONS,
  getAccentLabel,
  getToastStyleLabel,
  type ToastStyle,
} from "@arciin/shared"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AccentColorSelect } from "@/components/settings/accent-color-select"
import { SettingsSelect } from "@/components/settings/settings-select"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { ToastStylePreview } from "@/components/settings/toast-style-preview"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"

const POSITION_LABELS: Record<(typeof TOAST_POSITIONS)[number], string> = {
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
}

const RADIUS_LABELS: Record<(typeof UI_RADIUS_OPTIONS)[number], string> = {
  comfortable: "Comfortable",
  compact: "Compact",
  sharp: "Sharp",
}

export function AppearancePanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.appearance
  const busy = mutation.isPending

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (query.isError || !prefs) {
    const message =
      query.error instanceof Error ? query.error.message : "Could not load appearance preferences."
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
        <p className="font-medium">{message}</p>
      </div>
    )
  }

  const appearance = prefs

  function previewToast(style: ToastStyle = appearance.toastStyle) {
    const meta = TOAST_STYLE_META[style]
    toast.success(`${meta.label} style`, {
      description: `${meta.height} · ${meta.icon}. This is how live upload toasts will look.`,
    })
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={Palette}
            title="Accent color"
            description="Buttons, links, folder highlights, and toggles use this color."
          />
        </CardHeader>
        <CardContent>
          <SettingRow label="Color" hint="Saved to your account">
            <AccentColorSelect
              value={appearance.accentColor}
              disabled={busy}
              onChange={(hex) =>
                patch({ appearance: { accentColor: hex } }, `Accent: ${getAccentLabel(hex)}`)
              }
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={Palette}
            title="Layout"
            description="Spacing and motion in the dashboard."
          />
        </CardHeader>
        <CardContent>
          <SettingRow label="Compact view" hint="Tighter gaps and padding">
            <PillSwitch
              on={appearance.compactView}
              disabled={busy}
              onChange={() =>
                patch(
                  { appearance: { compactView: !appearance.compactView } },
                  appearance.compactView ? "Compact view off" : "Compact view on",
                )
              }
            />
          </SettingRow>
          <SettingRow label="Card hover motion" hint="Border feedback on cards">
            <PillSwitch
              on={appearance.animatedCards}
              disabled={busy}
              onChange={() =>
                patch(
                  { appearance: { animatedCards: !appearance.animatedCards } },
                  appearance.animatedCards ? "Card motion off" : "Card motion on",
                )
              }
            />
          </SettingRow>
          <SettingRow label="Corner radius" hint="Buttons, inputs, and cards">
            <SettingsSelect
              aria-label="Corner radius"
              value={appearance.uiRadius}
              disabled={busy}
              options={UI_RADIUS_OPTIONS.map((v) => ({ value: v, label: RADIUS_LABELS[v] }))}
              onValueChange={(uiRadius) =>
                patch({ appearance: { uiRadius } }, `Corners: ${RADIUS_LABELS[uiRadius]}`)
              }
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={MessageSquare}
            title="Toasts"
            description="Upload and system notifications (bottom of the screen)."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-3 text-[12px] font-medium text-zinc-600">
              Pick a style — each changes height, layout, and icon treatment. Click a card to apply.
            </p>
            <ToastStylePreview
              value={appearance.toastStyle}
              showIcons={appearance.toastShowIcons}
              disabled={busy}
              onChange={(toastStyle) => {
                patch(
                  { appearance: { toastStyle } },
                  `Toasts: ${getToastStyleLabel(toastStyle)}`,
                )
                setTimeout(() => previewToast(toastStyle), 120)
              }}
            />
          </div>
          <SettingRow label="Position" hint="Where notifications appear">
            <SettingsSelect
              aria-label="Toast position"
              value={appearance.toastPosition}
              disabled={busy}
              options={TOAST_POSITIONS.map((v) => ({ value: v, label: POSITION_LABELS[v] }))}
              onValueChange={(toastPosition) => {
                patch(
                  { appearance: { toastPosition } },
                  `Toasts: ${POSITION_LABELS[toastPosition]}`,
                )
                setTimeout(() => previewToast(), 100)
              }}
            />
          </SettingRow>
          <SettingRow label="Icons" hint="Show status icon on each toast">
            <PillSwitch
              on={appearance.toastShowIcons}
              disabled={busy}
              onChange={() => {
                patch(
                  { appearance: { toastShowIcons: !appearance.toastShowIcons } },
                  appearance.toastShowIcons ? "Toast icons off" : "Toast icons on",
                )
              }}
            />
          </SettingRow>
          <div className="border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-border"
              disabled={busy}
              onClick={() => previewToast()}
            >
              Preview live toast
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="px-1 text-[12px] text-zinc-500">Changes apply immediately and sync when you sign in elsewhere.</p>
    </div>
  )
}
