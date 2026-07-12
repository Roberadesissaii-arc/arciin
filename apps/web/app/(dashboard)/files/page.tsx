import { FilesPageIntro } from "@/components/libraries/files-page-intro"
import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function FilesPage() {
  return (
    <LibraryBrowser
      title="All Files"
      description="Search and manage assets across every library in the Arciin instance."
      intro={<FilesPageIntro />}
    />
  )
}
