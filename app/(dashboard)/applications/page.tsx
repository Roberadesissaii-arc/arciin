import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function ApplicationsPage() {
  return (
    <LibraryBrowser
      title="Applications"
      description="Installers and executables (.exe, .msi, .bat, disk images, and similar) live here."
      librarySlug="applications"
    />
  )
}
