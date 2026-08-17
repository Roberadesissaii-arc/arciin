"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Folder,
  Link2,
  Loader2,
  Share2,
  X,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { createShareLink } from "@/lib/api/shares"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary, FolderSummary } from "@/lib/types/models"
import { copyToClipboard } from "@/lib/utils/clipboard"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

type ShareTarget =
  | { resourceType: "ASSET"; asset: AssetSummary }
  | { resourceType: "ASSETS"; assets: AssetSummary[] }
  | { resourceType: "FOLDER"; folder: FolderSummary }

type CreatedShare = {
  url: string
  title: string
  target: ShareTarget
}

function targetLabel(target: ShareTarget) {
  if (target.resourceType === "FOLDER") return target.folder.name
  if (target.resourceType === "ASSETS") return `${target.assets.length} files`
  return target.asset.originalFilename
}

function ShareMultiAssetPreview({ assets }: { assets: AssetSummary[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(assets.length > 4)

  const updateScrollHint = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 6)
  }, [])

  useEffect(() => {
    updateScrollHint()
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(updateScrollHint)
    observer.observe(el)
    return () => observer.disconnect()
  }, [assets.length, updateScrollHint])

  function scrollDown() {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: el.clientHeight * 0.85, behavior: "smooth" })
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/80 bg-muted/20 p-2">
      <div
        ref={scrollRef}
        onScroll={updateScrollHint}
        className="scrollbar-hide aspect-square w-full overflow-y-auto overscroll-contain"
      >
        <div className="grid grid-cols-2 gap-2">
          {assets.map((asset) => (
            <ShareAssetThumb key={asset.id} asset={asset} compact />
          ))}
        </div>
      </div>
      {canScrollDown && assets.length > 4 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-muted/40 from-35% to-transparent px-2 pb-1 pt-10">
          <button
            type="button"
            onClick={scrollDown}
            className="pointer-events-auto flex size-7 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary"
            aria-label="Scroll to see more files"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SharePreviewVisual({ target }: { target: ShareTarget }) {
  if (target.resourceType === "FOLDER") {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-border/80 bg-gradient-to-br from-muted/50 to-muted/20 p-3">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Folder className="size-10 text-primary" />
          <span className="max-w-[12rem] truncate text-[12px] font-medium text-foreground">
            {target.folder.name}
          </span>
        </div>
      </div>
    )
  }

  const assets = target.resourceType === "ASSETS" ? target.assets : [target.asset]
  if (assets.length > 1) {
    return <ShareMultiAssetPreview assets={assets} />
  }

  return (
    <div className="rounded-lg border border-border/80 bg-muted/20 p-2.5">
      <ShareAssetThumb asset={assets[0]!} />
    </div>
  )
}

function ShareAssetThumb({ asset, compact = false }: { asset: AssetSummary; compact?: boolean }) {
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const showImage =
    asset.mediaType === "IMAGE" ||
    asset.mediaType === "VIDEO" ||
    asset.mediaType === "DOCUMENT"

  if (showImage) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-border/80 bg-muted/30",
          compact ? "aspect-square" : "aspect-[16/10]",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbSrc}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
        {!compact ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6">
            <p className="truncate text-[11px] font-medium text-white">{asset.originalFilename}</p>
            <p className="text-[10px] text-zinc-300">{formatBytes(asset.sizeBytes)}</p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-border/80 bg-gradient-to-br from-muted/50 to-muted/20",
        compact ? "aspect-square p-2" : "aspect-[16/10] p-4",
      )}
    >
      <MediaTypeIcon
        mediaType={asset.mediaType}
        filename={asset.originalFilename}
        mimeType={asset.mimeType}
        extension={asset.extension}
        className={cn("text-primary", compact ? "size-5" : "size-8")}
      />
      {!compact ? (
        <>
          <p className="max-w-full truncate text-[11px] font-medium text-foreground">
            {asset.originalFilename}
          </p>
          <p className="text-[10px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
        </>
      ) : null}
    </div>
  )
}

function ShareCreatedCard({ created }: { created: CreatedShare }) {
  const [copied, setCopied] = useState(false)
  const inputId = `share-url-${created.url.slice(-8)}`

  async function handleCopy() {
    const ok = await copyToClipboard(created.url, "Share link")
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/60">
      <div className="p-2">
        <SharePreviewVisual target={created.target} />
      </div>
      <div className="space-y-2 border-t border-border p-2.5">
        <div>
          <p className="text-[13px] font-semibold text-foreground">{created.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Preview of what recipients will see at this link.
          </p>
        </div>
        <p className="text-[12px] font-medium text-foreground">
          Copy this link now — it won&apos;t be shown again.
        </p>
        <Input
          id={inputId}
          readOnly
          value={created.url}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          className="h-9 w-full font-mono text-[11px] selection:bg-primary/20"
          aria-label="Share link"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2 border-border bg-card"
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            asChild
          >
            <a href={created.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Preview
            </a>
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Anyone with this link can view what you shared. They cannot browse your Arciin libraries or
          sign in as you.
        </p>
      </div>
    </div>
  )
}

/**
 * The share form itself, with no shell around it.
 *
 * Split out so the unified asset panel and the standalone sheet create links
 * through exactly the same mutation, expiry handling and security defaults. A
 * second copy of this form would be a second place for those defaults to
 * drift, which is not a risk worth taking with sharing.
 */
export function AssetShareContent({
  target,
  onDone,
}: {
  target: ShareTarget | null
  /** Called when the host should step back. Also resets the draft. */
  onDone?: () => void
}) {
  const [shareNote, setShareNote] = useState("")
  const [expiresInDays, setExpiresInDays] = useState<string>("7")
  const [allowDownload, setAllowDownload] = useState(true)
  const [createdShares, setCreatedShares] = useState<CreatedShare[]>([])

  const label = useMemo(() => (target ? targetLabel(target) : ""), [target])

  const createMutation = useMutation({
    mutationFn: createShareLink,
    onError: (err) => {
      toast.error("Could not create share link", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
    },
  })

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCreatedShares([])
      setShareNote("")
      setExpiresInDays("7")
      setAllowDownload(true)
      createMutation.reset()
      onDone?.()
    }
  }

  async function handleCreate() {
    if (!target) return

    const expires =
      expiresInDays === "never" ? undefined : Number.parseInt(expiresInDays, 10)
    const customLabel = shareNote.trim() || undefined

    if (target.resourceType === "FOLDER") {
      const result = await createMutation.mutateAsync({
        resourceType: "FOLDER",
        folderId: target.folder.id,
        label: customLabel ?? target.folder.name,
        expiresInDays: expires,
        allowDownload,
      })
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}${result.shareUrlPath}`
          : result.shareUrlPath
      setCreatedShares((prev) => [
        ...prev,
        {
          url,
          title: customLabel ?? target.folder.name,
          target,
        },
      ])
      toast.success("Folder share link created.", {
        description: "Anyone with the link can view this folder until it expires.",
      })
      return
    }

    if (target.resourceType === "ASSETS") {
      const defaultLabel = `${target.assets.length} files`
      const result = await createMutation.mutateAsync({
        resourceType: "ASSETS",
        assetIds: target.assets.map((asset) => asset.id),
        label: customLabel ?? defaultLabel,
        expiresInDays: expires,
        allowDownload,
      })
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}${result.shareUrlPath}`
          : result.shareUrlPath
      setCreatedShares([
        {
          url,
          title: customLabel ?? defaultLabel,
          target,
        },
      ])
      toast.success("Share link created.", {
        description: "Anyone with the link can view these files until it expires.",
      })
      return
    }

    const result = await createMutation.mutateAsync({
      resourceType: "ASSET",
      assetId: target.asset.id,
      label: customLabel ?? target.asset.title?.trim() ?? target.asset.originalFilename,
      expiresInDays: expires,
      allowDownload,
    })
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${result.shareUrlPath}`
        : result.shareUrlPath
    setCreatedShares([
      {
        url,
        title: customLabel ?? target.asset.title?.trim() ?? target.asset.originalFilename,
        target,
      },
    ])
    toast.success("Share link created.", {
      description: "Anyone with the link can view this file until it expires.",
    })
  }

  return (
    <>
        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
          {createdShares.length > 0 ? (
            <div className="space-y-3">
              {createdShares.map((created) => (
                <ShareCreatedCard key={created.url} created={created} />
              ))}
            </div>
          ) : (
            <>
              <Field>
                <FieldLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Note for recipients
                </FieldLabel>
                <FieldDescription className="mb-2 text-[12px] leading-relaxed">
                  Optional title or message shown on the share page when someone opens the link.
                </FieldDescription>
                <Input
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  placeholder={label}
                  maxLength={200}
                  className="h-10 bg-muted/40"
                />
              </Field>

              <Field>
                <FieldLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Link expires
                </FieldLabel>
                <FieldDescription className="mb-2 text-[12px] leading-relaxed">
                  After expiry the link stops working. You can revoke links anytime from Activity.
                </FieldDescription>
                <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                  <SelectTrigger className="h-10 w-full bg-muted/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[200]">
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <Checkbox
                  checked={allowDownload}
                  onCheckedChange={(v) => setAllowDownload(v === true)}
                />
                <div>
                  <Label className="text-[13px] font-medium text-foreground">Allow download</Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Recipients can download files from this share. Preview is always available.
                  </p>
                </div>
              </label>
            </>
          )}
        </div>

        <SheetFooter className="shrink-0 border-t border-border p-2">
          {createdShares.length > 0 ? (
            <Button
              type="button"
              className="h-10 w-full bg-primary text-white hover:bg-primary/90"
              onClick={() => handleOpenChange(false)}
            >
              Done
            </Button>
          ) : (
            <Button
              type="button"
              className="h-10 w-full gap-2 bg-primary text-white hover:bg-primary/90"
              disabled={!target || createMutation.isPending}
              onClick={() => void handleCreate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Create share link
            </Button>
          )}
        </SheetFooter>
    </>
  )
}

/**
 * The standalone Share sheet.
 *
 * Still used for multi-asset shares from the bulk bar; now only a shell around
 * the shared form.
 */
export function ShareDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ShareTarget | null
}) {
  const label = target ? targetLabel(target) : ""
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
      >
        <SheetHeader className="relative shrink-0 space-y-1 border-b border-border p-2 pr-11">
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
          <SheetTitle className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
            <Share2 className="size-4 text-primary" />
            Share
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
            Create a private link for{" "}
            <span className="font-medium text-foreground">{label}</span>. Recipients only see this
            item — not your full library.
          </SheetDescription>
        </SheetHeader>
        {open ? <AssetShareContent target={target} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

export function ShareDialogTrigger({
  target,
  children,
  className,
}: {
  target: ShareTarget
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <span className={className} onClick={() => setOpen(true)}>
        {children}
      </span>
      <ShareDialog open={open} onOpenChange={setOpen} target={target} />
    </>
  )
}
