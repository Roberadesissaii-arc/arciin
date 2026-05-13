import Link from "next/link"
import { Folder } from "lucide-react"

import type { FolderSummary } from "@/lib/types/models"

export function FolderCard({ folder, librarySlug }: { folder: FolderSummary; librarySlug: string }) {
  const href = `/${librarySlug}/${folder.slug}`

  return (
    <Link href={href} className="group block select-none">
      {/* Folder tab */}
      <div className="ml-3 h-[10px] w-[40%] rounded-t-[6px] bg-white/[0.07] transition-colors group-hover:bg-white/[0.11]" />
      {/* Folder body */}
      <div className="relative rounded-b-2xl rounded-tr-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-5 transition-all group-hover:border-white/[0.11] group-hover:bg-white/[0.06]">
        {/* File count badge — top-right corner */}
        {folder.assetCount > 0 && (
          <div className="absolute right-3 top-3 rounded-md bg-white/[0.07] px-2 py-1 text-[12px] font-semibold tabular-nums text-white/50 transition-colors group-hover:bg-white/[0.10] group-hover:text-white/70">
            {folder.assetCount} {folder.assetCount === 1 ? "file" : "files"}
          </div>
        )}
        <Folder className="mb-3 h-7 w-7 text-white/25 transition-colors group-hover:text-white/45" />
        <div className="truncate text-[13px] font-semibold text-white/90">{folder.name}</div>
        <div className="mt-0.5 text-[11px] text-white/35">Folder</div>
      </div>
    </Link>
  )
}
