"use client"

import { CircleCheckIcon } from "lucide-react"
import { TOAST_STYLES, TOAST_STYLE_META, type ToastStyle } from "@arciin/shared"

import { cn } from "@/lib/utils"

function PreviewToast({
  style,
  selected,
  showIcons,
  onSelect,
}: {
  style: ToastStyle
  selected: boolean
  showIcons: boolean
  onSelect: () => void
}) {
  const meta = TOAST_STYLE_META[style]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/5 ring-2 ring-primary/25"
          : "border-border bg-white hover:border-zinc-300 hover:bg-zinc-50/80",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">{meta.label}</span>
        {selected && (
          <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            Active
          </span>
        )}
      </div>
      <div
        className={cn("arciin-toast-preview", `arciin-toast-preview--${style}`)}
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
      <ul className="mt-2.5 space-y-0.5 text-[10px] leading-snug text-zinc-500">
        <li>
          <span className="font-medium text-zinc-600">Height:</span> {meta.height}
        </li>
        <li>
          <span className="font-medium text-zinc-600">Layout:</span> {meta.layout}
        </li>
        <li>
          <span className="font-medium text-zinc-600">Icon:</span> {meta.icon}
        </li>
      </ul>
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
    <div className="grid gap-3 sm:grid-cols-2">
      {TOAST_STYLES.map((style) => (
        <PreviewToast
          key={style}
          style={style}
          selected={value === style}
          showIcons={showIcons}
          onSelect={() => !disabled && onChange(style)}
        />
      ))}
    </div>
  )
}
