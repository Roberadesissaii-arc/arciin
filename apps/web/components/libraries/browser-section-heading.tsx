import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Matches “Folders” / “Assets” hierarchy under the library toolbar (not the folder tile). */
export function BrowserSectionHeading({
  children,
  end,
  className,
}: {
  children: ReactNode
  /** Right-aligned meta on the same underline, e.g. computer backup status. */
  end?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 border-b border-zinc-200/90 pb-2",
        className
      )}
    >
      <div className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {children}
      </div>
      {end ? <div className="min-w-0 shrink-0">{end}</div> : null}
    </div>
  )
}
