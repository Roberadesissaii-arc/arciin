import { FolderBrowser } from "@/components/libraries/folder-browser"

export default async function DocumentsFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>
}) {
  const { folder } = await params

  return (
    <FolderBrowser
      librarySlug="documents"
      libraryTitle="Documents"
      folderSlug={folder}
      mediaType="DOCUMENT"
    />
  )
}
