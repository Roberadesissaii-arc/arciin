import type { Metadata } from "next"

import { PublicFileRequestPage } from "@/components/file-requests/public-file-request-page"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ token: string }>
}

/**
 * Metadata is deliberately generic and never fetched from the API.
 *
 * A share page can safely put its label in the title because the recipient is
 * meant to see the content. An upload link is different: resolving the token
 * server-side to build a title would leak the request's existence and title
 * into link previews, crawler logs and browser history for anyone who merely
 * receives the URL.
 */
export const metadata: Metadata = {
  title: "File request · Arciin",
  description: "Upload files to a private Arciin folder.",
  robots: { index: false, follow: false },
}

export default async function FileRequestRoutePage({ params }: PageProps) {
  const { token } = await params
  return <PublicFileRequestPage token={token} />
}
