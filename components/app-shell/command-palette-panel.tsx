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
  "h-10 border-white/[0.1] bg-[rgba(2,2,6,0.72)] text-[rgba(255,255,255,0.95)] placeholder:text-[rgba(255,255,255,0.32)] shadow-inner shadow-black/20 backdrop-blur-md focus-visible:border-white/[0.14] focus-visible:ring-white/15"

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
        "max-h-[min(70vh,440px)] min-h-0 bg-[rgba(4,4,10,0.62)]"
      )}
    >
      <div className="border-b border-white/[0.08] bg-black/30 px-3 py-2.5 backdrop-blur-md">
        <p className="text-xs font-medium text-zinc-500">Jump to</p>
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
                className="flex w-full items-center justify-between rounded-lg border border-transparent px-3 py-2.5 text-left text-sm text-zinc-100 transition-colors hover:border-white/[0.08] hover:bg-white/[0.06]"
                onClick={() => {
                  router.push(item.href)
                  onClose()
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.05] text-zinc-400">
                    <Icon className="size-4" />
                  </span>
                  <span className="truncate">{item.title}</span>
                </span>
                <Badge
                  variant="outline"
                  className="ml-2 shrink-0 border-white/[0.1] bg-transparent text-[10px] text-zinc-500"
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
