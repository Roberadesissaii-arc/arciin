"use client"

import type React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const triggerClass =
  "h-9 w-full max-w-full border-border bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 lg:w-[220px]"

/** Outer shell — padding lives on the viewport, not here. */
const contentClass =
  "settings-select-content z-[200] max-h-60 min-w-[var(--radix-select-trigger-width)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-zinc-200 !bg-white p-0 text-zinc-900 shadow-lg ring-0"

const viewportClass = "px-3 py-2.5"

const itemClass = cn(
  "relative flex w-full cursor-default select-none items-center rounded-xl border border-transparent",
  "py-2.5 pl-3 pr-12 text-[13px] font-medium leading-none text-zinc-600",
  "outline-none",
  "data-[highlighted]:border-transparent data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900",
  "focus:border-transparent focus:bg-zinc-100 focus:text-zinc-900",
  "data-[state=checked]:border-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_28%,transparent)]",
  "data-[state=checked]:bg-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_12%,white)]",
  "data-[state=checked]:text-zinc-900",
  "data-[state=checked]:data-[highlighted]:bg-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_16%,white)]",
)

const indicatorClass =
  "pointer-events-none absolute inset-y-0 right-3 flex w-5 items-center justify-center text-[var(--arciin-accent,#ff4f12)]"

const labelClass = "px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500"

const groupClass = "space-y-0.5"

export function SettingsSelect<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: T
  onValueChange: (value: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
  placeholder?: string
  "aria-label"?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <SelectTrigger className={triggerClass} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="end"
        sideOffset={4}
        hideScrollButtons
        className={contentClass}
        viewportClassName={viewportClass}
      >
        {options.map((opt) => (
          <SettingsSelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SettingsSelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function SettingsSelectTrigger({
  className,
  ...props
}: React.ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger className={cn(triggerClass, className)} {...props} />
}

export function SettingsSelectContent({
  className,
  viewportClassName,
  ...props
}: React.ComponentProps<typeof SelectContent> & {
  viewportClassName?: string
}) {
  return (
    <SelectContent
      position="popper"
      align="end"
      sideOffset={4}
      hideScrollButtons
      className={cn(contentClass, className)}
      viewportClassName={cn(viewportClass, viewportClassName)}
      {...props}
    />
  )
}

export function SettingsSelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(itemClass, className)}
      {...props}
    >
      <span className={indicatorClass}>
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 shrink-0" strokeWidth={2.5} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate [&_*]:text-inherit">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export function SettingsSelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectLabel>) {
  return <SelectLabel className={cn(labelClass, className)} {...props} />
}

export function SettingsSelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectGroup>) {
  return <SelectGroup className={cn(groupClass, className)} {...props} />
}
