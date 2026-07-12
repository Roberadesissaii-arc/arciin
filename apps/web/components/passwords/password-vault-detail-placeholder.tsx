"use client"

import { ChevronLeft, ChevronRight, FingerprintPattern } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PANEL_TOP_BAR = "flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-5"

export function PasswordVaultDetailPlaceholder({
  total,
  collapsed,
  onExpand,
}: {
  total: number
  collapsed?: boolean
  onExpand?: () => void
}) {
  return (
    <div
      className={cn(
        "flex min-h-[min(420px,70vh)] flex-col overflow-hidden rounded-2xl",
        "border border-border bg-card shadow-sm",
      )}
    >
      <div className={PANEL_TOP_BAR}>
        <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
          Entry preview
        </p>
        <div className="flex items-center gap-1 opacity-40">
          <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg" disabled>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg" disabled>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
          <FingerprintPattern className="size-7" strokeWidth={1.5} />
        </div>
        <p className="mt-4 text-sm font-semibold text-foreground">
          {collapsed ? "Detail panel closed" : "Select a credential"}
        </p>
        <p className="mt-1 max-w-[15rem] text-sm leading-relaxed text-muted-foreground">
          {collapsed
            ? "Re-open the preview to browse usernames, passwords, and site links."
            : `Choose any of your ${total} saved ${total === 1 ? "entry" : "entries"} in the table to preview it here.`}
        </p>
        {collapsed && onExpand ? (
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onExpand}>
            Show preview
          </Button>
        ) : null}
      </div>

      <p className="border-t border-border px-5 py-2.5 text-center text-[11px] text-muted-foreground">
        Brand icons appear here when a known service is detected
      </p>
    </div>
  )
}

export { PANEL_TOP_BAR }
