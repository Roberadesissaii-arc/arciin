import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function ImagesPage() {
  return (
    <LibraryBrowser
      title="Images"
      description="Browse screenshots, photography, and generated image assets."
      librarySlug="images"
      mediaType="IMAGE"
    />
  )
}
