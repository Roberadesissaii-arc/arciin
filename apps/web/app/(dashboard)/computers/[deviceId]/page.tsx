import { ComputerBrowser } from "@/components/computers/computer-browser"

export default async function ComputerPage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>
  searchParams: Promise<{ folder?: string }>
}) {
  const { deviceId } = await params
  const { folder } = await searchParams
  return <ComputerBrowser deviceId={deviceId} folderId={folder} />
}
