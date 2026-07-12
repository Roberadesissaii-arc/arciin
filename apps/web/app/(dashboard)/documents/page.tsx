import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function DocumentsPage() {
  return (
    <LibraryBrowser
      title="Documents"
      description="Receipts, notes, PDFs, and structured documents routed into the archive."
      librarySlug="documents"
      mediaType="DOCUMENT"
    />
  )
}
