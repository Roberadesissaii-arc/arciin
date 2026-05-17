import { cn } from "@/lib/utils"

/** Shared icon holder — follows `--arciin-accent*` tokens from appearance settings. */
export const accentIconShellBase =
  "flex shrink-0 items-center justify-center rounded-xl bg-[var(--arciin-accent-icon-bg)] text-[var(--arciin-accent)]"

export const accentIconShellMd = cn(
  accentIconShellBase,
  "size-10 ring-1 ring-inset ring-[var(--arciin-accent-icon-ring)]",
)

export const accentIconShellSm = cn(
  accentIconShellBase,
  "mt-0.5 size-8 border border-[var(--arciin-accent-icon-border)]",
)

export const accentBadgeSurface =
  "border border-[var(--arciin-accent-badge-border)] bg-[var(--arciin-accent-badge-bg)] text-[var(--arciin-accent)]"

export const accentProgressFill =
  "bg-gradient-to-r from-[var(--arciin-accent)] to-[var(--arciin-accent-hover)]"

export const accentText = "text-[var(--arciin-accent)]"
