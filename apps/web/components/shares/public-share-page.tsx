"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  FileAudio,
  Folder,
  Loader2,
  Lock,
  Server,
  Shield,
  X,
} from "lucide-react"

import { AUTH_HERO_GRADIENT } from "@/components/auth/auth-light"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { ShareFeedbackButtons } from "@/components/shares/share-feedback-buttons"
import { Button } from "@/components/ui/button"
import { ArciinMarkLetter } from "@/components/ui/arciin-icon"
import {
  getPublicShareView,
  publicShareDownloadUrl,
  publicSharePreviewUrl,
  publicShareThumbnailUrl,
} from "@/lib/api/shares"
import type { PublicShareAsset, PublicShareView } from "@/lib/types/models"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

/** Shared horizontal rhythm: nav, content, and footer align on the same edges. */
const SHARE_PAGE_SHELL = "mx-auto w-full max-w-[83rem] px-4 sm:px-5 lg:px-6"

const SHARE_ASSET_GRID =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5"

async function downloadSharedAssets(token: string, assets: PublicShareAsset[]) {
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!
    const anchor = document.createElement("a")
    anchor.href = publicShareDownloadUrl(token, asset.id)
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    if (i < assets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 280))
    }
  }
}

function ShareIntroPanel() {
  return (
    <section
      className="relative overflow-hidden rounded-2xl px-4 py-5 sm:px-5 sm:py-6"
      style={{ background: AUTH_HERO_GRADIENT }}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-white/10 blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/4 size-24 rounded-full bg-black/10 blur-2xl"
        aria-hidden
      />
      <div className="relative flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Server className="size-4 shrink-0 text-white/90" aria-hidden />
            <p className="font-heading text-[15px] font-semibold tracking-tight text-white sm:text-base">
              Your server, your control.
            </p>
          </div>
          <span className="inline-flex shrink-0 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/90">
            Shared with you
          </span>
        </div>
        <p className="max-w-2xl text-[12px] leading-relaxed text-white/85">
          You&apos;ve been sent a link to view selected files. Browse what&apos;s here, preview or
          save anything you need, and know that access is limited to this page — nothing beyond what
          was shared with you.
        </p>
      </div>
    </section>
  )
}

function ShareDownloadAllButton({
  token,
  assets,
  allowDownload,
}: {
  token: string
  assets: PublicShareAsset[]
  allowDownload: boolean
}) {
  const [busy, setBusy] = useState(false)

  if (!allowDownload || assets.length < 2) return null

  return (
    <Button
      type="button"
      size="sm"
      disabled={busy}
      className="h-9 shrink-0 gap-1.5 bg-primary px-3 text-[11px] text-primary-foreground hover:bg-primary/90"
      onClick={() => {
        setBusy(true)
        void downloadSharedAssets(token, assets).finally(() => setBusy(false))
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      Download all
    </Button>
  )
}

function shareThumbSrc(token: string, asset: PublicShareAsset) {
  if (asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO" || asset.mediaType === "DOCUMENT") {
    return `${publicShareThumbnailUrl(token, asset.id)}?v=${encodeURIComponent(asset.updatedAt)}`
  }
  return null
}

function canPreviewSharedAsset(asset: PublicShareAsset) {
  return asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO"
}

function PublicShareAssetPreviewOverlay({
  open,
  onOpenChange,
  token,
  assets,
  index,
  onIndexChange,
  allowDownload,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  assets: PublicShareAsset[]
  index: number
  onIndexChange: (index: number) => void
  allowDownload: boolean
}) {
  const asset = assets[index]
  const hasPrev = index > 0
  const hasNext = index < assets.length - 1
  const showNav = assets.length > 1

  const previewSrc = asset ? publicSharePreviewUrl(token, asset.id) : ""
  const downloadHref = asset ? publicShareDownloadUrl(token, asset.id) : "#"
  const thumbSrc = asset ? shareThumbSrc(token, asset) : null

  useEffect(() => {
    if (!open || !asset) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onOpenChange(false)
        return
      }
      if (event.key === "ArrowLeft" && hasPrev) {
        event.preventDefault()
        onIndexChange(index - 1)
      }
      if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault()
        onIndexChange(index + 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [asset, hasNext, hasPrev, index, onIndexChange, onOpenChange, open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !asset || typeof document === "undefined") return null

  const navButtonClass =
    "absolute top-1/2 z-20 size-9 -translate-y-1/2 rounded-full border border-border bg-card/95 text-foreground shadow-md backdrop-blur-sm hover:bg-card disabled:pointer-events-none disabled:opacity-35"

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${asset.originalFilename}`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        aria-label="Close preview"
        onClick={() => onOpenChange(false)}
      />
      <div className="dashboard-main relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_-24px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-foreground">{asset.originalFilename}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatBytes(asset.sizeBytes)}
              {showNav ? (
                <span className="text-muted-foreground/80">{` · ${index + 1} of ${assets.length}`}</span>
              ) : null}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Close preview"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="relative flex min-h-[min(72vh,760px)] min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-3 sm:p-4">
          {showNav ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(navButtonClass, "left-2 sm:left-3")}
              disabled={!hasPrev}
              aria-label="Previous file"
              onClick={() => onIndexChange(index - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          ) : null}

          <div className="flex max-h-[min(72vh,760px)] w-full items-center justify-center px-8 sm:px-10">
            {asset.mediaType === "IMAGE" ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewSrc}
                alt={asset.originalFilename}
                className="max-h-[min(72vh,760px)] max-w-full object-contain"
              />
            ) : asset.mediaType === "VIDEO" ? (
              <video
                key={asset.id}
                controls
                playsInline
                poster={thumbSrc ?? undefined}
                className="max-h-[min(72vh,760px)] max-w-full rounded-lg bg-black"
                src={previewSrc}
              />
            ) : null}
          </div>

          {showNav ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(navButtonClass, "right-2 sm:right-3")}
              disabled={!hasNext}
              aria-label="Next file"
              onClick={() => onIndexChange(index + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 sm:px-4">
          <ShareFeedbackButtons key={asset.id} token={token} assetId={asset.id} />
          {allowDownload ? (
            <Button asChild className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
              <a href={downloadHref} download>
                <Download className="size-4" />
                Download
              </a>
            </Button>
          ) : (
            <p className="text-[12px] text-muted-foreground">Download disabled for this share.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PublicShareAssetGrid({
  token,
  assets,
  allowDownload,
}: {
  token: string
  assets: PublicShareAsset[]
  allowDownload: boolean
}) {
  const previewableAssets = useMemo(
    () => assets.filter((asset) => canPreviewSharedAsset(asset)),
    [assets],
  )
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const openPreview = (assetId: string) => {
    const nextIndex = previewableAssets.findIndex((entry) => entry.id === assetId)
    if (nextIndex >= 0) setPreviewIndex(nextIndex)
  }

  return (
    <>
      <ul className={SHARE_ASSET_GRID}>
        {assets.map((asset) => (
          <PublicFolderAssetTile
            key={asset.id}
            token={token}
            asset={asset}
            allowDownload={allowDownload}
            onOpenPreview={
              canPreviewSharedAsset(asset) ? () => openPreview(asset.id) : undefined
            }
          />
        ))}
      </ul>

      {previewIndex !== null && previewableAssets[previewIndex] ? (
        <PublicShareAssetPreviewOverlay
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPreviewIndex(null)
          }}
          token={token}
          assets={previewableAssets}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          allowDownload={allowDownload}
        />
      ) : null}
    </>
  )
}

function ShareMetaPills({ view }: { view: PublicShareView }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
        <Shield className="size-3 text-primary" />
        Private share
      </span>
      {!view.allowDownload ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          View only
        </span>
      ) : null}
      {view.expiresAt ? (
        <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
          Expires {new Date(view.expiresAt).toLocaleDateString()}
        </span>
      ) : null}
    </div>
  )
}

function defaultAssetCountLabel(count: number) {
  return count === 1 ? "1 file" : `${count} files`
}

function shareCollectionHeading(label: string, count: number) {
  const defaultLabel = defaultAssetCountLabel(count)
  if (label.trim() === defaultLabel) {
    return { title: defaultLabel, description: undefined as string | undefined }
  }
  return { title: label, description: defaultLabel }
}

function SharePageHeader() {
  return (
    <div className={cn("shrink-0 pt-3", SHARE_PAGE_SHELL)}>
      <header className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-sm sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ArciinMarkLetter size="sm" className="shrink-0" />
          <span className="font-heading text-[15px] font-semibold tracking-tight text-foreground">
            Arciin
          </span>
          <span className="text-[13px] font-medium text-muted-foreground">Share</span>
        </div>
        <p className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
          Private link · not your library
        </p>
      </header>
    </div>
  )
}

function ShareContentHeader({
  title,
  description,
  action,
  toolbar,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  toolbar?: React.ReactNode
}) {
  return (
    <div className="border-b border-border bg-muted/30 px-3 py-3 sm:px-4">
      {action}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {toolbar}
      </div>
    </div>
  )
}

function PublicAssetHero({
  token,
  asset,
  label,
  view,
}: {
  token: string
  asset: PublicShareAsset
  label: string
  view: Extract<PublicShareView, { resourceType: "ASSET" }>
}) {
  const previewSrc = publicSharePreviewUrl(token, asset.id)
  const downloadHref = publicShareDownloadUrl(token, asset.id)
  const thumbSrc = shareThumbSrc(token, asset)
  const { allowDownload } = view

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <ShareContentHeader title={label} description={asset.originalFilename} />

      <div className="px-3 py-4 sm:px-4 sm:py-5">
        <div className="mx-auto flex max-w-4xl flex-col items-center">
          {asset.mediaType === "IMAGE" ? (
            <div className="w-full overflow-hidden rounded-xl border border-border bg-muted/30 p-2 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt={asset.originalFilename}
                className="mx-auto max-h-[min(68vh,760px)] w-full rounded-lg object-contain"
              />
            </div>
          ) : asset.mediaType === "VIDEO" ? (
            <div className="w-full overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm">
              <video
                controls
                playsInline
                poster={thumbSrc ?? undefined}
                className="max-h-[68vh] w-full bg-black/95"
                src={previewSrc}
              />
            </div>
          ) : asset.mediaType === "AUDIO" ? (
            <div className="w-full max-w-xl rounded-2xl border border-border bg-muted/20 p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
                  <FileAudio className="size-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{asset.originalFilename}</p>
                  <p className="text-[12px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
                </div>
              </div>
              <audio controls className="w-full" src={previewSrc} />
            </div>
          ) : (
            <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-muted/20 px-8 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <MediaTypeIcon
                  mediaType={asset.mediaType}
                  filename={asset.originalFilename}
                  mimeType={asset.mimeType}
                  extension={asset.extension}
                  className="size-8 text-primary"
                />
              </div>
              <div>
                <p className="font-medium text-foreground">{asset.originalFilename}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {allowDownload ? (
              <Button asChild className="h-10 gap-2 bg-primary px-5 text-primary-foreground hover:bg-primary/90">
                <a href={downloadHref} download>
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            ) : (
              <p className="text-[12px] text-muted-foreground">Download disabled for this share.</p>
            )}
            <span className="text-[12px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</span>
          </div>
        </div>
      </div>
    </article>
  )
}

function PublicFolderAssetTile({
  token,
  asset,
  allowDownload,
  onOpenPreview,
}: {
  token: string
  asset: PublicShareAsset
  allowDownload: boolean
  onOpenPreview?: () => void
}) {
  const thumbSrc = shareThumbSrc(token, asset)
  const downloadHref = publicShareDownloadUrl(token, asset.id)
  const canPreview = Boolean(onOpenPreview)

  return (
    <li className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/25 hover:shadow-sm">
      <button
        type="button"
        className={cn(
          "relative block aspect-[4/3] w-full overflow-hidden bg-muted/40 text-left",
          canPreview && "cursor-zoom-in",
        )}
        disabled={!canPreview}
        aria-label={canPreview ? `Preview ${asset.originalFilename}` : asset.originalFilename}
        onClick={() => {
          onOpenPreview?.()
        }}
      >
          {thumbSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbSrc}
                alt=""
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
            </>
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <MediaTypeIcon
                mediaType={asset.mediaType}
                filename={asset.originalFilename}
                mimeType={asset.mimeType}
                extension={asset.extension}
                className="size-8"
              />
            </div>
          )}
          {canPreview ? (
            <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-lg border border-white/10 bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <Expand className="size-3.5" />
            </span>
          ) : null}
        </button>
        <div className="space-y-1.5 p-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-foreground">{asset.originalFilename}</p>
            <p className="text-[10px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
          </div>
          {allowDownload ? (
            <Button
              asChild
              size="sm"
              className="h-9 w-full gap-1.5 bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
            >
              <a href={downloadHref} download>
                <Download className="size-3.5" />
                Download
              </a>
            </Button>
          ) : null}
        </div>
      </li>
  )
}

function PublicFolderBrowser({
  token,
  view,
  folderId,
  onNavigate,
}: {
  token: string
  view: Extract<PublicShareView, { resourceType: "FOLDER" }>
  folderId: string | null
  onNavigate: (folderId: string | null) => void
}) {
  const { folder, label } = view
  const atRoot = folderId == null

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <ShareContentHeader
        title={atRoot ? label : folder.name}
        description={`${folder.folders.length} folders · ${folder.assets.length} files`}
        toolbar={
          <ShareDownloadAllButton
            token={token}
            assets={folder.assets}
            allowDownload={view.allowDownload}
          />
        }
        action={
          !atRoot ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-3 -ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => onNavigate(null)}
            >
              <ChevronLeft className="size-4" />
              Back to shared folder
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-3 p-2 sm:p-3">
        {folder.folders.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {folder.folders.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(entry.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Folder className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{entry.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {entry.assetCount} {entry.assetCount === 1 ? "file" : "files"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {folder.assets.length > 0 ? (
          <PublicShareAssetGrid
            token={token}
            assets={folder.assets}
            allowDownload={view.allowDownload}
          />
        ) : null}

        {folder.folders.length === 0 && folder.assets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
            This folder is empty.
          </p>
        ) : null}
      </div>
    </article>
  )
}

function PublicAssetsCollection({
  token,
  view,
}: {
  token: string
  view: Extract<PublicShareView, { resourceType: "ASSETS" }>
}) {
  const { assets, label } = view
  const heading = shareCollectionHeading(label, assets.length)

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <ShareContentHeader
        title={heading.title}
        description={heading.description}
        toolbar={
          <ShareDownloadAllButton
            token={token}
            assets={assets}
            allowDownload={view.allowDownload}
          />
        }
      />

      <div className="p-2 sm:p-3">
        {assets.length > 0 ? (
          <PublicShareAssetGrid
            token={token}
            assets={assets}
            allowDownload={view.allowDownload}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
            No files in this share.
          </p>
        )}
      </div>
    </article>
  )
}

export function PublicSharePage({ token }: { token: string }) {
  const [folderId, setFolderId] = useState<string | null>(null)

  const shareQuery = useQuery({
    queryKey: ["public-share", token, folderId],
    queryFn: ({ signal }) => getPublicShareView(token, folderId ?? undefined, signal),
    retry: false,
  })

  const view = shareQuery.data

  return (
    <div className="flex min-h-svh flex-col">
      <SharePageHeader />
      <main className={cn("flex flex-1 flex-col gap-3 py-3 sm:py-4", SHARE_PAGE_SHELL)}>
        <ShareIntroPanel />
        {shareQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            Loading share…
          </div>
        ) : shareQuery.isError ? (
          <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
            <p className="text-lg font-semibold text-foreground">Link unavailable</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {shareQuery.error instanceof Error
                ? shareQuery.error.message
                : "This share link is invalid, expired, or was revoked."}
            </p>
          </div>
        ) : view ? (
          <div className="space-y-3">
            <ShareMetaPills view={view} />
            {view.resourceType === "ASSET" ? (
              <PublicAssetHero token={token} asset={view.asset} label={view.label} view={view} />
            ) : view.resourceType === "ASSETS" ? (
              <PublicAssetsCollection token={token} view={view} />
            ) : (
              <PublicFolderBrowser
                token={token}
                view={view}
                folderId={folderId}
                onNavigate={setFolderId}
              />
            )}
          </div>
        ) : null}
      </main>

      <footer className={cn("mt-auto shrink-0 border-t border-border bg-background py-3", SHARE_PAGE_SHELL)}>
        <p className="text-center text-[11px] text-muted-foreground">
          Shared securely from a private Arciin instance
        </p>
      </footer>
    </div>
  )
}
