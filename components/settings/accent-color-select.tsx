"use client"

import { ACCENT_COLORS, getAccentLabel } from "@arciin/shared"

import { Select, SelectValue } from "@/components/ui/select"
import {
  SettingsSelectContent,
  SettingsSelectGroup,
  SettingsSelectItem,
  SettingsSelectLabel,
  SettingsSelectTrigger,
} from "@/components/settings/settings-select"

const GROUPS = ["Brand", "Warm", "Vivid", "Cool", "Neutral"] as const

export function AccentColorSelect({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (hex: string) => void
}) {
  const label = getAccentLabel(value)

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SettingsSelectTrigger aria-label="Accent color">
        <SelectValue>
          <span className="flex items-center gap-2">
            <span
              className="size-4 shrink-0 rounded-sm border border-zinc-200/80"
              style={{ backgroundColor: value }}
              aria-hidden
            />
            <span className="truncate text-zinc-900">{label}</span>
          </span>
        </SelectValue>
      </SettingsSelectTrigger>
      <SettingsSelectContent>
        {GROUPS.map((group) => {
          const items = ACCENT_COLORS.filter((c) => c.group === group)
          if (items.length === 0) return null
          return (
            <SettingsSelectGroup key={group}>
              <SettingsSelectLabel>{group}</SettingsSelectLabel>
              {items.map(({ hex, label: itemLabel }) => (
                <SettingsSelectItem key={hex} value={hex}>
                  <span className="flex items-center gap-2.5">
                    <span
                      className="size-4 shrink-0 rounded-md border border-zinc-200/90 shadow-sm"
                      style={{ backgroundColor: hex }}
                      aria-hidden
                    />
                    <span>{itemLabel}</span>
                  </span>
                </SettingsSelectItem>
              ))}
            </SettingsSelectGroup>
          )
        })}
      </SettingsSelectContent>
    </Select>
  )
}
