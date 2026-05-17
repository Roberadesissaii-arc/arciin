"use client"

import { MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { TOAST_POSITIONS, TOAST_STYLE_META, getToastStyleLabel, type ToastStyle } from "@arciin/shared"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
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

export function ToastsPanel() {
  const { query, mutation, patch } = useUserPreferencesSettings()
  const prefs = query.data?.appearance
  const busy = mutation.isPending

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  if (query.isError || !prefs) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
        {query.error instanceof Error ? query.error.message : "Could not load preferences."}
      </div>
    )
  }

  const appearance = prefs

  function previewToast(style: ToastStyle = appearance.toastStyle) {
    const meta = TOAST_STYLE_META[style]
    toast.success(meta.label, {
      description: meta.tagline,
    })
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={MessageSquare}
            title="Toast designs"
            description="Fifteen card-style presets. Pick one — uploads and system alerts use it live."
          />
        </CardHeader>
        <CardContent className="space-y-5">
          <ToastStylePreview
            value={appearance.toastStyle}
            showIcons={appearance.toastShowIcons}
            disabled={busy}
            onChange={(toastStyle) => {
              patch({ appearance: { toastStyle } }, `Toasts: ${getToastStyleLabel(toastStyle)}`)
              setTimeout(() => previewToast(toastStyle), 120)
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={MessageSquare}
            title="Behavior"
            description="Where notifications appear and whether icons show."
          />
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow label="Position" hint="Corner of the screen">
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
          <SettingRow label="Icons" hint="Status icon on each toast">
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
          <div className="border-t border-border pt-4">
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
    </div>
  )
}
