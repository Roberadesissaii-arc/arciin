import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function DocumentsPage() {
  return (
    <LibraryBrowser
      title="Documents"
      description="PDFs, Office files, and notes. Scripts and other unclassified types go to Inbox."
      librarySlug="documents"
    />
  )
}
