import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function MusicPage() {
  return (
    <LibraryBrowser
      title="Music"
      description="Track audio files, albums, and personal recordings in one place."
      librarySlug="music"
      mediaType="AUDIO"
    />
  )
}
