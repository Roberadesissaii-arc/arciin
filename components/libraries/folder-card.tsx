import Link from "next/link"
import { Folder } from "lucide-react"

import type { FolderSummary } from "@/lib/types/models"

export function FolderCard({ folder, librarySlug }: { folder: FolderSummary; librarySlug: string }) {
  const href = `/${librarySlug}/${folder.slug}`

  return (
    <Link href={href} className="group block select-none">
      <div className="ml-3 h-[10px] w-[40%] rounded-t-[6px] bg-gradient-to-b from-primary/45 to-primary/20 ring-1 ring-inset ring-primary/35 transition-[filter,box-shadow] group-hover:from-primary/55 group-hover:to-primary/28" />
      <div className="relative overflow-hidden rounded-b-2xl rounded-tr-2xl border border-zinc-200/95 bg-gradient-to-b from-[var(--arciin-accent-soft,#fff7ed)] via-zinc-100/90 to-zinc-50/95 px-4 py-5 shadow-sm ring-1 ring-inset ring-primary/20 transition-all group-hover:border-primary/35 group-hover:from-[var(--arciin-accent-soft,#fff7ed)] group-hover:via-zinc-50 group-hover:shadow-md">
        <div className="pointer-events-none absolute inset-0 opacity-90" aria-hidden>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, var(--arciin-accent-wash, color-mix(in srgb, var(--arciin-accent, #ff4f12) 14%, transparent)) 0%, transparent 42%)",
            }}
          />
          <div
            className="absolute -top-16 left-1/2 w-[min(85%,280px)] -translate-x-1/2 blur-[44px]"
            style={{
              background:
                "radial-gradient(ellipse at 50% 0%, var(--arciin-accent-glow, color-mix(in srgb, var(--arciin-accent, #ff4f12) 18%, transparent)) 0%, transparent 65%)",
            }}
          />
        </div>
        {folder.assetCount > 0 && (
          <div className="absolute right-3 top-3 rounded-md border border-zinc-200/80 bg-white/90 px-2 py-1 text-[12px] font-semibold tabular-nums text-zinc-700 shadow-sm transition-colors group-hover:border-primary/25 group-hover:text-zinc-900">
            {folder.assetCount} {folder.assetCount === 1 ? "file" : "files"}
          </div>
        )}
        <div className="relative">
          <Folder className="mb-3 h-7 w-7 text-primary/85 transition-colors group-hover:text-primary" />
          <div className="truncate text-[13px] font-semibold text-zinc-900">{folder.name}</div>
          <div className="mt-0.5 text-[11px] font-medium text-zinc-600">Folder</div>
        </div>
      </div>
    </Link>
  )
}
