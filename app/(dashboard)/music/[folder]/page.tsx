import { FolderBrowser } from "@/components/libraries/folder-browser"

export default async function MusicFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>
}) {
  const { folder } = await params

  return (
    <FolderBrowser
      librarySlug="music"
      folderSlug={folder}
      mediaType="AUDIO"
    />
  )
}
