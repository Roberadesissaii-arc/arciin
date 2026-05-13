import { FolderBrowser } from "@/components/libraries/folder-browser"

export default async function VideosFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>
}) {
  const { folder } = await params

  return (
    <FolderBrowser
      librarySlug="videos"
      libraryTitle="Videos"
      folderSlug={folder}
      mediaType="VIDEO"
    />
  )
}
