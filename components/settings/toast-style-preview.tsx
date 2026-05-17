"use client"

import {
  Activity,
  Archive,
  Box,
  Cloud,
  Feather,
  Flower2,
  Gem,
  Layers,
  MessageSquare,
  Minus,
  Moon,
  PanelBottom,
  Radio,
  Sparkles,
  Wind,
  Waves,
  CircleCheckIcon,
  type LucideIcon,
} from "lucide-react"
import { TOAST_STYLES, TOAST_STYLE_META, type ToastStyle, type ToastStyleIcon } from "@arciin/shared"

import { cn } from "@/lib/utils"

const STYLE_ICONS: Record<ToastStyleIcon, LucideIcon> = {
  Sparkles,
  Layers,
  Cloud,
  Gem,
  Wind,
  Archive,
  Radio,
  Waves,
  PanelBottom,
  Activity,
  Flower2,
  Box,
  Moon,
  Feather,
  Minus,
}

function PreviewToastCard({
  style,
  selected,
  showIcons,
  disabled,
  onSelect,
}: {
  style: ToastStyle
  selected: boolean
  showIcons: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const meta = TOAST_STYLE_META[style]
  const Icon = STYLE_ICONS[meta.icon] ?? MessageSquare

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group flex h-full flex-col rounded-2xl border bg-white p-4 text-left transition-all",
        selected
          ? "border-primary/50 bg-primary/[0.04] ring-2 ring-primary/25 shadow-[0_0_24px_color-mix(in_srgb,var(--arciin-accent,#ff4f12)_18%,transparent)]"
          : "border-border hover:border-zinc-300 hover:shadow-md",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            selected ? "bg-primary/15 text-primary" : "bg-zinc-100 text-zinc-600 group-hover:bg-zinc-200/80",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        {selected ? (
          <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
            Active
          </span>
        ) : null}
      </div>

      <h4 className="text-[14px] font-semibold text-foreground">{meta.label}</h4>
      <p className="mt-1 text-[12px] font-medium leading-snug text-zinc-600">{meta.tagline}</p>
      <p className="mt-1.5 flex-1 text-[11px] leading-relaxed text-zinc-500">{meta.description}</p>

      <div
        className={cn("arciin-toast-preview mt-4 w-full", `arciin-toast-preview--${style}`)}
        data-toast-preview-style={style}
        data-show-icons={showIcons ? "1" : "0"}
        aria-hidden
      >
        {showIcons && (
          <span className="arciin-toast-preview-icon" data-type="success">
            <CircleCheckIcon className="size-full" />
          </span>
        )}
        <span className="arciin-toast-preview-body">
          <span className="arciin-toast-preview-title">Upload complete</span>
          <span className="arciin-toast-preview-desc">3 files added to Videos</span>
        </span>
      </div>
    </button>
  )
}

export function ToastStylePreview({
  value,
  showIcons,
  disabled,
  onChange,
}: {
  value: ToastStyle
  showIcons: boolean
  disabled?: boolean
  onChange: (style: ToastStyle) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {TOAST_STYLES.map((style) => (
        <PreviewToastCard
          key={style}
          style={style}
          selected={value === style}
          showIcons={showIcons}
          disabled={disabled}
          onSelect={() => onChange(style)}
        />
      ))}
    </div>
  )
}
