"use client"

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { useQueries } from "@tanstack/react-query"

import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section"
import { getAssets } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { useLibraries } from "@/hooks/use-libraries"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

const LIBRARY_ROUTES: Record<string, string> = {
  inbox: "/inbox",
  videos: "/videos",
  images: "/images",
  music: "/music",
  documents: "/documents",
}

const LIBRARY_ORDER = ["videos", "images", "music", "documents", "inbox"]

/** Prefer types whose thumbnails always render well, but fall back to the
    newest asset of any type — documents/audio may still have generated thumbs. */
const PREFERRED_COVER_TYPES = new Set(["IMAGE", "VIDEO"])

function pickCoverAsset(assets: AssetSummary[]): AssetSummary | null {
  return (
    assets.find((asset) => PREFERRED_COVER_TYPES.has(asset.mediaType)) ??
    assets[0] ??
    null
  )
}

/** Dedicated placeholder artwork per library (desk-scene set). */
const LIBRARY_PLACEHOLDER_ART: Record<string, string> = {
  videos: "/assets/library-placeholders/videos.webp",
  images: "/assets/library-placeholders/images.webp",
  music: "/assets/library-placeholders/music.webp",
  documents: "/assets/library-placeholders/documents.webp",
  inbox: "/assets/library-placeholders/inbox.webp",
}

/** Fallback artwork if a placeholder file is missing — sign-in hero images. */
const LIBRARY_FALLBACK_ART: Record<string, string> = {
  videos: "/assets/auth-hero/library-videos.webp",
  images: "/assets/auth-hero/library-photos.webp",
  music: "/assets/auth-hero/library-music.webp",
  documents: "/assets/auth-hero/library-collections.webp",
  inbox: "/assets/auth-hero/library-playlists.webp",
}

/** Placeholder for empty libraries (or failed thumbnails). */
function LibraryCoverPlaceholder({ slug }: { slug: string }) {
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const src = primaryFailed
    ? (LIBRARY_FALLBACK_ART[slug] ?? LIBRARY_FALLBACK_ART.inbox)
    : (LIBRARY_PLACEHOLDER_ART[slug] ?? LIBRARY_PLACEHOLDER_ART.inbox)

  return (
    <Image
      src={src}
      alt=""
      fill
      unoptimized={!primaryFailed}
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      onError={() => setPrimaryFailed(true)}
    />
  )
}

function LibraryCover({ slug, coverAsset }: { slug: string; coverAsset?: AssetSummary }) {
  const [imageFailed, setImageFailed] = useState(false)

  if (!coverAsset || imageFailed) {
    return <LibraryCoverPlaceholder slug={slug} />
  }

  return (
    <Image
      src={`/api/assets/${coverAsset.id}/thumbnail?v=${encodeURIComponent(coverAsset.updatedAt)}`}
      alt=""
      fill
      unoptimized
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      onError={() => setImageFailed(true)}
    />
  )
}

/** Media library grid — real library covers (newest image/video thumbnail). */
export function MediaLibrarySection({ className }: { className?: string }) {
  const librariesQuery = useLibraries()

  const libraries = [...(librariesQuery.data ?? [])]
    .filter((lib) => LIBRARY_ROUTES[lib.slug] !== undefined)
    .sort((a, b) => LIBRARY_ORDER.indexOf(a.slug) - LIBRARY_ORDER.indexOf(b.slug))

  // Newest thumbnail-worthy asset per library — one query per non-empty library.
  const coverQueries = useQueries({
    queries: libraries.map((lib) => ({
      queryKey: queryKeys.assets({ libraryId: lib.id, scope: "dashboard-cover" }),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getAssets({ libraryId: lib.id }, signal),
      enabled: (lib.assetCount ?? 0) > 0,
      staleTime: 30_000,
      select: pickCoverAsset,
    })),
  })

  const covers = new Map<string, AssetSummary>()
  libraries.forEach((lib, i) => {
    const cover = coverQueries[i]?.data
    if (cover) covers.set(lib.id, cover)
  })

  return (
    <section className={className}>
      <DashboardSectionHeader
        title="Media library"
        description="Open a library to browse folders and assets."
        href="/files"
      />

      {librariesQuery.isLoading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[5/4] rounded-xl" />
          ))}
        </div>
      ) : librariesQuery.isError ? (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
          {librariesQuery.error instanceof Error
            ? librariesQuery.error.message
            : "Could not load libraries."}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {libraries.map((lib) => (
            <Link key={lib.id} href={LIBRARY_ROUTES[lib.slug]!} className="group min-w-0">
              <div
                className={cn(
                  "relative aspect-[5/4] overflow-hidden rounded-xl border border-zinc-200/80",
                  "shadow-sm transition-all duration-200",
                  "group-hover:border-primary/40 group-hover:shadow-md",
                )}
              >
                <LibraryCover
                  slug={lib.slug}
                  coverAsset={lib.slug === "music" ? undefined : covers.get(lib.id)}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2.5 pb-2 pt-6">
                  <p className="truncate text-[13px] font-semibold text-white">{lib.name}</p>
                  <p className="text-[11px] tabular-nums text-white/80">
                    {(lib.assetCount ?? 0).toLocaleString()} items
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
