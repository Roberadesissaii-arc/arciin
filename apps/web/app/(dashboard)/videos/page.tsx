import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function VideosPage() {
  return (
    <LibraryBrowser
      title="Videos"
      description="Manage films, captures, and long-form media stored in your video library."
      librarySlug="videos"
      mediaType="VIDEO"
    />
  )
}
