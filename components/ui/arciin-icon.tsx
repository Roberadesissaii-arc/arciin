import Image from "next/image"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const sizePx = {
  sm: 24,
  md: 32,
  lg: 40,
  xl: 48,
} as const

const markHeightPx = {
  sm: 20,
  md: 26,
  lg: 32,
} as const

/** App tile — black square + orange arch (favicon-style). */
export function ArciinIcon({
  size = "md",
  className,
  ...props
}: {
  size?: keyof typeof sizePx
  className?: string
} & Omit<ComponentProps<typeof Image>, "src" | "alt" | "width" | "height">) {
  const px = sizePx[size]
  return (
    <Image
      src="/arciin-icon.svg"
      alt="Arciin"
      width={px}
      height={px}
      className={cn("shrink-0 rounded-[22%]", className)}
      priority
      {...props}
    />
  )
}

/** Orange “A” mark only — no tile (for inline wordmark). */
export function ArciinMarkLetter({
  size = "md",
  className,
}: {
  size?: keyof typeof markHeightPx
  className?: string
}) {
  const h = markHeightPx[size]
  const w = Math.round(h * 0.92)
  return (
    <Image
      src="/arciin-mark.svg"
      alt=""
      width={w}
      height={h}
      aria-hidden
      className={cn("block shrink-0", className)}
      style={{ width: w, height: h }}
      priority
    />
  )
}

/** Expanded sidebar — full wordmark text only (logo shows when collapsed). */
export function ArciinSidebarWordmarkText({
  className,
  textClassName,
}: {
  className?: string
  textClassName?: string
}) {
  return (
    <span
      className={cn(
        "font-heading text-[17px] font-bold leading-none tracking-tight text-white",
        className,
        textClassName,
      )}
      aria-label="Arciin"
    >
      Arciin<span className="text-[#ff4f12]">.</span>
    </span>
  )
}

/** Sidebar wordmark: [A]rciin. — mark is the “A”, optically aligned with the type. */
export function ArciinSidebarWordmark({
  className,
  textClassName,
}: {
  className?: string
  textClassName?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0 font-heading text-[17px] font-bold leading-none tracking-tight",
        className,
      )}
      aria-label="Arciin"
    >
      <ArciinMarkLetter
        size="md"
        className="-mr-[0.08em] h-[1em] w-[0.9em] translate-y-px"
      />
      <span className={cn("text-white", textClassName)}>
        rciin<span className="text-[#ff4f12]">.</span>
      </span>
    </span>
  )
}
