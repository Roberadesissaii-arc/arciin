import { FolderCard } from "@/components/libraries/folder-card"
import type { FolderSummary } from "@/lib/types/models"

export function FolderGrid({ folders, librarySlug }: { folders: FolderSummary[]; librarySlug: string }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} librarySlug={librarySlug} />
      ))}
    </div>
  )
}
