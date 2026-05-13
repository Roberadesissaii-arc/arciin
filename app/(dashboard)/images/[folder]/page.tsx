import { FolderBrowser } from "@/components/libraries/folder-browser"

export default async function ImagesFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>
}) {
  const { folder } = await params

  return (
    <FolderBrowser
      librarySlug="images"
      libraryTitle="Images"
      folderSlug={folder}
      mediaType="IMAGE"
    />
  )
}
