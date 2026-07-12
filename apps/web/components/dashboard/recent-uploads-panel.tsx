"use client"

import Link from "next/link"
import { useState } from "react"

import { AssetStatusBadge } from "@/components/dashboard/asset-status-badge"
import { FileTypePlaceholder } from "@/components/libraries/file-type-placeholder"
import { VideoHoverThumb } from "@/components/libraries/video-hover-thumb"
import { Skeleton } from "@/components/ui/skeleton"
import { useAssets } from "@/hooks/use-assets"
import { useLibraries } from "@/hooks/use-libraries"
import {
  dashboardFeedEmpty,
  dashboardOverviewUploadsBody,
  DASHBOARD_UPLOADS_LIMIT,
  dashboardUploadsGrid,
} from "@/lib/dashboard-card-styles"
import { formatMediaTypeLabel } from "@/lib/utils/media-type"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

const LIBRARY_ROUTES: Record<string, string> = {
  inbox: "/inbox",
  videos: "/videos",
  images: "/images",
  music: "/music",
  documents: "/documents",
}

/** Glassy bottom-right chip — matches the video duration badge's look. */
function TypeLabelBadge({ label }: { label: string }) {
  if (!label) return null
  return (
    <span
      className="pointer-events-none absolute bottom-1 right-1 z-20 rounded-xl bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none text-white backdrop-blur-sm"
    >
      {label}
    </span>
  )
}

function UploadPlaceholder({ asset }: { asset: AssetSummary }) {
  return (
    <FileTypePlaceholder
      mediaType={asset.mediaType}
      filename={asset.originalFilename}
      mimeType={asset.mimeType}
      extension={asset.extension}
      className="size-full border-0"
      iconClassName="size-6"
    />
  )
}

function UploadTilePreview({ asset }: { asset: AssetSummary }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const typeLabel = formatMediaTypeLabel(asset.mediaType, {
    filename: asset.originalFilename,
    mimeType: asset.mimeType,
    extension: asset.extension,
  })

  if (asset.mediaType === "VIDEO") {
    return (
      <VideoHoverThumb
        asset={asset}
        showDuration
        className="absolute inset-0 bg-gradient-to-br from-zinc-50 to-zinc-100"
      />
    )
  }

  if (thumbFailed) {
    return (
      <>
        <div className="absolute inset-0">
          <UploadPlaceholder asset={asset} />
        </div>
        <TypeLabelBadge label={typeLabel} />
      </>
    )
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbSrc}
        alt=""
        className="absolute inset-0 size-full object-cover"
        loading="lazy"
        onError={() => setThumbFailed(true)}
      />
      <TypeLabelBadge label={typeLabel} />
    </>
  )
}

function UploadGridTile({
  asset,
  librarySlug,
}: {
  asset: AssetSummary
  librarySlug?: string
}) {
  const href = librarySlug && LIBRARY_ROUTES[librarySlug] ? LIBRARY_ROUTES[librarySlug] : "/files"

  return (
    <Link
      href={href}
      title={asset.originalFilename}
      className={cn(
        "group relative block aspect-square overflow-hidden rounded-lg",
        "border border-zinc-300/90 bg-zinc-50 shadow-sm ring-1 ring-inset ring-zinc-200/80",
        "transition-all hover:border-primary/40 hover:shadow-md hover:ring-primary/15",
      )}
    >
      <UploadTilePreview asset={asset} />
      {asset.status !== "READY" ? (
        <div className="absolute left-1 top-1 z-10 scale-90">
          <AssetStatusBadge status={asset.status} />
        </div>
      ) : null}
    </Link>
  )
}

export function RecentUploadsPanel({ className }: { className?: string }) {
  const assetsQuery = useAssets()
  const librariesQuery = useLibraries()

  const assets = (assetsQuery.data ?? []).slice(0, DASHBOARD_UPLOADS_LIMIT)

  const libraryById = new Map<string, { slug: string }>()
  for (const lib of librariesQuery.data ?? []) {
    libraryById.set(lib.id, { slug: lib.slug })
  }

  if (assetsQuery.isLoading) {
    return (
      <div className={cn(dashboardOverviewUploadsBody, className)}>
        <div className={dashboardUploadsGrid}>
          {Array.from({ length: DASHBOARD_UPLOADS_LIMIT }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg border border-zinc-200/80" />
          ))}
        </div>
      </div>
    )
  }

  if (assetsQuery.isError) {
    return (
      <div className={cn(dashboardOverviewUploadsBody, className)}>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
          {assetsQuery.error instanceof Error
            ? assetsQuery.error.message
            : "Could not load recent uploads."}
        </div>
      </div>
    )
  }

  if (!assets.length) {
    return (
      <div className={cn(dashboardOverviewUploadsBody, className)}>
        <div className={dashboardFeedEmpty}>
          <p className="text-sm font-semibold text-zinc-900">No uploads yet</p>
          <p className="mt-1 max-w-[16rem] text-sm leading-relaxed text-zinc-500">
            Drop files anywhere in the app to start routing them into your libraries.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(dashboardOverviewUploadsBody, className)}>
      <div className={dashboardUploadsGrid}>
        {assets.map((asset) => {
          const lib = libraryById.get(asset.libraryId)
          return (
            <UploadGridTile
              key={asset.id}
              asset={asset}
              librarySlug={lib?.slug}
            />
          )
        })}
      </div>
    </div>
  )
}
