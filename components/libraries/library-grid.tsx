import { LibraryCard } from "@/components/libraries/library-card"
import type { LibrarySummary } from "@/lib/types/models"

export function LibraryGrid({ libraries }: { libraries: LibrarySummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {libraries.map((library) => (
        <LibraryCard key={library.id} library={library} />
      ))}
    </div>
  )
}
