import { FolderCard } from "@/components/libraries/folder-card"
import type { FolderSummary } from "@/lib/types/models"

export function FolderGrid({ folders, librarySlug }: { folders: FolderSummary[]; librarySlug: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} librarySlug={librarySlug} />
      ))}
    </div>
  )
}
