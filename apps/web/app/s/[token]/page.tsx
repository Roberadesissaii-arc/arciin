import type { Metadata } from "next"

import { PublicSharePage } from "@/components/shares/public-share-page"
import { getServerApiOrigin } from "@/lib/server/api-origin"
import type { PublicShareView } from "@/lib/types/models"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ token: string }>
}

async function fetchShareMeta(token: string): Promise<PublicShareView | null> {
  try {
    const origin = getServerApiOrigin()
    const res = await fetch(
      `${origin}/api/shares/access/${encodeURIComponent(token)}?meta=1`,
      { cache: "no-store" },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { data?: PublicShareView }
    return body.data ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  const view = await fetchShareMeta(token)

  if (!view) {
    return {
      title: "Shared · Arciin",
      description: "Private shared file or folder",
      robots: { index: false, follow: false },
    }
  }

  const description =
    view.resourceType === "ASSET"
      ? `View ${view.asset.originalFilename} via a private Arciin share link.`
      : view.resourceType === "ASSETS"
        ? `View ${view.assets.length} shared files via a private Arciin share link.`
        : `Browse ${view.label} via a private Arciin share link.`

  const firstImage =
    view.resourceType === "ASSET" && view.asset.mediaType === "IMAGE"
      ? view.asset
      : view.resourceType === "ASSETS"
        ? view.assets.find((asset) => asset.mediaType === "IMAGE")
        : undefined

  const ogImage = firstImage
    ? `/api/shares/access/${encodeURIComponent(token)}/thumbnail/${encodeURIComponent(firstImage.id)}`
    : undefined

  return {
    title: `${view.label} · Arciin`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: view.label,
      description,
      type: "website",
      images: ogImage ? [{ url: ogImage, alt: view.label }] : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: view.label,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  }
}

export default async function ShareRoutePage({ params }: PageProps) {
  const { token } = await params
  return <PublicSharePage token={token} />
}
