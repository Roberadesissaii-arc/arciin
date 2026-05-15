"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import {
  developerNavigation,
  operationsNavigation,
  primaryNavigation,
  systemNavigation,
  type NavigationItem,
} from "@/components/app-shell/navigation"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { libraryGlassCommandPaletteSurface } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"

const glassInput =
  "h-10 border-border bg-muted/50 text-foreground placeholder:text-muted-foreground shadow-inner shadow-black/[0.04] backdrop-blur-md focus-visible:border-primary/30 focus-visible:ring-primary/15"

function flattenItems(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => [item, ...(item.children || [])])
}

export function CommandPalettePanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const router = useRouter()

  const allItems = useMemo(() => {
    const flat = flattenItems([
      ...primaryNavigation,
      ...operationsNavigation,
      ...developerNavigation,
      ...systemNavigation,
    ])
    const deduped: NavigationItem[] = []
    const seen = new Set<string>()
    for (const item of flat) {
      if (seen.has(item.href)) {
        continue
      }
      seen.add(item.href)
      deduped.push(item)
    }
    return deduped
  }, [])

  const filteredItems = allItems.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div
      className={cn(
        libraryGlassCommandPaletteSurface,
        "dashboard-main max-h-[min(70vh,440px)] min-h-0"
      )}
    >
      <div className="border-b border-zinc-200/80 bg-gradient-to-b from-orange-50/55 via-white/65 to-transparent px-3 py-2.5 backdrop-blur-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Jump to</p>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search dashboard, libraries, settings…"
          className={cn("mt-2", glassInput)}
          autoFocus
        />
      </div>
      <div className="scrollbar-hide min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {filteredItems.length ? (
          filteredItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={`${item.href}-${item.title}`}
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:border-orange-200/50 hover:bg-orange-50/45 hover:shadow-sm"
                onClick={() => {
                  router.push(item.href)
                  onClose()
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200/80 bg-white/70 text-zinc-600 shadow-sm">
                    <Icon className="size-4" />
                  </span>
                  <span className="truncate font-medium">{item.title}</span>
                </span>
                <Badge
                  variant="outline"
                  className="ml-2 shrink-0 border-zinc-200/90 bg-white/60 text-[10px] font-mono text-zinc-500"
                >
                  {item.href}
                </Badge>
              </button>
            )
          })
        ) : (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">No matches.</p>
        )}
      </div>
    </div>
  )
}
