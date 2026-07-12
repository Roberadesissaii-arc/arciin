"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BADGE_COLOR_PRESETS } from "@/lib/utils/asset-badge"
import type { AssetSourceInfo } from "@/lib/utils/asset-source"
import { cn } from "@/lib/utils"

export type BadgeColorOption = {
  id: string
  label: string
  color: string
  isAuto?: boolean
}

export function buildBadgeColorOptions(autoSource: AssetSourceInfo | null): BadgeColorOption[] {
  const options: BadgeColorOption[] = []

  if (autoSource) {
    options.push({
      id: "auto",
      label: `Auto (${autoSource.label})`,
      color: autoSource.color,
      isAuto: true,
    })
  }

  for (const preset of BADGE_COLOR_PRESETS) {
    options.push({ id: preset.id, label: preset.label, color: preset.color })
  }

  return options
}

export function resolveBadgeColorOptionId(
  options: BadgeColorOption[],
  color: string,
  useCustomColor: boolean,
): string {
  if (!useCustomColor) {
    const auto = options.find((option) => option.isAuto)
    if (auto) return auto.id
  }

  const normalized = color.trim().toLowerCase()
  const match = options.find((option) => option.color.toLowerCase() === normalized)
  return match?.id ?? options[0]?.id ?? "arciin"
}

function BadgeColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className={cn(
        "size-2.5 shrink-0 rounded-full ring-1 ring-black/10",
        className,
      )}
    />
  )
}

export function BadgeColorSelect({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: string
  options: BadgeColorOption[]
  onChange: (option: BadgeColorOption) => void
  disabled?: boolean
  className?: string
}) {
  const selected = options.find((option) => option.id === value) ?? options[0]

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(nextId) => {
        const option = options.find((item) => item.id === nextId)
        if (option) onChange(option)
      }}
    >
      <SelectTrigger
        className={cn(
          "h-10 w-full border-border bg-muted/40 text-foreground hover:bg-muted/50",
          className,
        )}
      >
        <SelectValue placeholder="Pick a color">
          {selected ? (
            <span className="flex items-center gap-2">
              <BadgeColorDot color={selected.color} />
              <span className="truncate text-[13px]">{selected.label}</span>
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} className="py-2">
            <span className="flex items-center gap-2.5">
              <BadgeColorDot color={option.color} className="size-3" />
              <span>{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
