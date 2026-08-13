"use client"
/* eslint-disable react-hooks/set-state-in-effect -- intentional prop-sync: reset the form state when the dialog opens or the target asset changes. */

import { useEffect, useMemo, useState } from "react"
import {
  Globe,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Sparkles,
  Tag,
  X,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { notifyFileUpdated } from "@/lib/notifications/toast-actions"

import { AssetSourceBadge } from "@/components/libraries/asset-source-badge"
import {
  BadgeColorSelect,
  buildBadgeColorOptions,
  resolveBadgeColorOptionId,
} from "@/components/libraries/badge-color-select"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useUpdateAsset } from "@/hooks/use-assets"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import {
  isValidBadgeColor,
  resolveAssetBadge,
} from "@/lib/utils/asset-badge"
import { detectAssetSource } from "@/lib/utils/asset-source"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

const glassInput =
  "h-10 border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/20"

type BadgeDraft = {
  showBadge: boolean
  label: string
  color: string
  useCustomLabel: boolean
  useCustomColor: boolean
}

function buildBadgeDraft(asset: AssetSummary): BadgeDraft {
  const auto = detectAssetSource(asset.importSourceUrl)
  const hasCustomLabel = Boolean(asset.badgeLabel?.trim())
  const hasCustomColor = Boolean(asset.badgeColor?.trim())

  return {
    showBadge: asset.showBadge !== false,
    label: asset.badgeLabel?.trim() || auto?.label || "",
    color: asset.badgeColor?.trim() || auto?.color || "#FF4F12",
    useCustomLabel: hasCustomLabel || !auto?.label,
    useCustomColor: hasCustomColor,
  }
}

function badgePayloadFromDraft(
  asset: AssetSummary,
  draft: BadgeDraft,
): {
  badgeLabel?: string | null
  badgeColor?: string | null
  showBadge?: boolean
} {
  const auto = detectAssetSource(asset.importSourceUrl)
  const payload: {
    badgeLabel?: string | null
    badgeColor?: string | null
    showBadge?: boolean
  } = {}

  const desiredShowBadge = draft.showBadge
  if (desiredShowBadge !== (asset.showBadge !== false)) {
    payload.showBadge = desiredShowBadge
  }

  const desiredLabel =
    !draft.useCustomLabel && auto?.label ? null : draft.label.trim() || null
  if (desiredLabel !== (asset.badgeLabel ?? null)) {
    payload.badgeLabel = desiredLabel
  }

  const desiredColor = draft.useCustomColor ? draft.color.trim() || null : null
  if (desiredColor !== (asset.badgeColor ?? null)) {
    payload.badgeColor = desiredColor
  }

  return payload
}

export function RenameAssetDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(asset.originalFilename)
  const [badgeDraft, setBadgeDraft] = useState<BadgeDraft>(() => buildBadgeDraft(asset))
  const [error, setError] = useState<string | undefined>()

  const [coverPending, setCoverPending] = useState(false)

  /**
   * Draw a cover for this file.
   *
   * The image replaces the cached thumbnail on disk, so the card picks it up on
   * its next load. The URL is cache-busted afterwards because the filename does
   * not change — without that the browser keeps showing the page render it
   * already has.
   */
  async function generateCover() {
    if (coverPending) return
    setCoverPending(true)
    try {
      const response = await fetch(`/api/assets/${asset.id}/cover`, {
        method: "POST",
        credentials: "include",
      })
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      if (!response.ok) {
        toast.error("Could not generate a cover", {
          description: body?.error?.message ?? "The image service did not return an image.",
        })
        return
      }
      toast.success("Cover image generated", {
        description: "The card will show it on the next load.",
      })
    } catch {
      toast.error("Could not generate a cover", {
        description: "Check that the API is reachable from this device.",
      })
    } finally {
      setCoverPending(false)
    }
  }
  const updateAssetMutation = useUpdateAsset()

  useEffect(() => {
    if (open) {
      setName(asset.originalFilename)
      setBadgeDraft(buildBadgeDraft(asset))
      setError(undefined)
    }
  }, [open, asset])

  const autoSource = useMemo(
    () => detectAssetSource(asset.importSourceUrl),
    [asset.importSourceUrl],
  )

  const colorOptions = useMemo(() => buildBadgeColorOptions(autoSource), [autoSource])

  const selectedColorId = useMemo(
    () => resolveBadgeColorOptionId(colorOptions, badgeDraft.color, badgeDraft.useCustomColor),
    [colorOptions, badgeDraft.color, badgeDraft.useCustomColor],
  )

  const previewBadge = useMemo(() => {
    if (!badgeDraft.showBadge) return null
    const label = badgeDraft.label.trim()
    if (!label) return null
    return {
      label,
      color: badgeDraft.color,
      show: true,
    }
  }, [badgeDraft])

  const resolvedCurrent = resolveAssetBadge(asset)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("A name is required.")
      return
    }

    if (badgeDraft.showBadge && badgeDraft.label.trim() && !isValidBadgeColor(badgeDraft.color)) {
      setError("Pick a valid badge color.")
      return
    }

    const payload: {
      assetId: string
      originalFilename?: string
      badgeLabel?: string | null
      badgeColor?: string | null
      showBadge?: boolean
    } = { assetId: asset.id }

    if (trimmed !== asset.originalFilename) {
      payload.originalFilename = trimmed
    }

    Object.assign(payload, badgePayloadFromDraft(asset, badgeDraft))

    if (Object.keys(payload).length === 1) {
      onOpenChange(false)
      return
    }

    try {
      await updateAssetMutation.mutateAsync(payload)
      notifyFileUpdated()
      onOpenChange(false)
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Could not update asset."
      setError(message)
      toast.error("Could not update asset", { description: message })
    }
  }

  function resetBadgeToAuto() {
    if (!autoSource) return
    setBadgeDraft((current) => ({
      ...current,
      label: autoSource.label,
      color: autoSource.color,
      useCustomLabel: false,
      useCustomColor: false,
    }))
  }

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
          <SheetTitle className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Edit file
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
            Rename the file and customize the badge shown on its card — label, color, or hide it
            entirely.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
          <Field>
            <FieldLabel
              htmlFor="assetName"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              File name
            </FieldLabel>
            <Input
              id="assetName"
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.target.value)
                setError(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !updateAssetMutation.isPending) {
                  event.preventDefault()
                  void submit()
                }
              }}
              className={glassInput}
            />
          </Field>

          <div className="space-y-3 rounded-xl border border-border bg-muted/15 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Tag className="size-3.5" />
                  Badge
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {autoSource
                    ? `Auto-detected as ${autoSource.label}. Customize the label or color, or hide it.`
                    : "Add a custom badge label and color for this file."}
                </p>
              </div>
              <div
                className="inline-flex shrink-0 rounded-lg border border-border bg-muted/30 p-0.5"
                role="group"
                aria-label="Badge visibility"
              >
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                    badgeDraft.showBadge
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setBadgeDraft((current) => ({ ...current, showBadge: true }))}
                >
                  Show badge
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                    !badgeDraft.showBadge
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setBadgeDraft((current) => ({ ...current, showBadge: false }))}
                >
                  Hide
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-border/70 bg-card p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </p>
              <div className="flex min-h-8 items-center gap-2">
                {badgeDraft.showBadge && previewBadge ? (
                  <AssetSourceBadge
                    asset={asset}
                    preview={previewBadge}
                    className="max-w-none"
                  />
                ) : (
                  <span className="text-sm font-medium text-zinc-400">—</span>
                )}
                {resolvedCurrent && badgeDraft.showBadge ? (
                  <span className="text-[11px] text-muted-foreground">
                    {autoSource ? (
                      <>
                        Source:{" "}
                        <span className="font-medium text-foreground">{autoSource.label}</span>
                      </>
                    ) : (
                      "Custom badge"
                    )}
                  </span>
                ) : null}
              </div>
            </div>

            {badgeDraft.showBadge ? (
              <>
                <Field>
                  <FieldLabel
                    htmlFor="badgeLabel"
                    className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Badge label
                  </FieldLabel>
                  <Input
                    id="badgeLabel"
                    value={badgeDraft.label}
                    placeholder={autoSource?.label ?? "My badge"}
                    maxLength={32}
                    onChange={(event) =>
                      setBadgeDraft((current) => ({
                        ...current,
                        label: event.target.value,
                        useCustomLabel: true,
                      }))
                    }
                    className={glassInput}
                  />
                </Field>

                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel
                      htmlFor="badgeColor"
                      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Badge color
                    </FieldLabel>
                    {autoSource ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                        onClick={resetBadgeToAuto}
                      >
                        <RotateCcw className="size-3" />
                        Reset to auto
                      </Button>
                    ) : null}
                  </div>
                  <BadgeColorSelect
                    value={selectedColorId}
                    options={colorOptions}
                    onChange={(option) =>
                      setBadgeDraft((current) => ({
                        ...current,
                        color: option.color,
                        useCustomColor: !option.isAuto,
                      }))
                    }
                  />
                </Field>

                {!autoSource ? (
                  <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
                    <Globe className="mt-0.5 size-3.5 shrink-0" />
                    <p>
                      This file was not imported from a link. Your badge label and color will show
                      on the card instead of a source chip.
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Same shell as the badge block above: this is another per-file
              setting, and a bare field beneath a bordered one reads as an
              afterthought rather than part of the same dialog. */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/15 p-3">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ImageIcon className="size-3.5" />
                Cover image
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Read this file and draw a cover from what it is about, instead of showing the
                first page.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5 text-[11px] font-semibold"
              disabled={coverPending}
              onClick={() => void generateCover()}
            >
              {coverPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {coverPending ? "Drawing the cover…" : "Generate cover image"}
            </Button>
          </div>

          <FieldError errors={[error ? { message: error } : undefined]} />
        </div>

        <SheetFooter className="shrink-0 border-t border-border p-2">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={updateAssetMutation.isPending}
            onClick={() => void submit()}
          >
            <Pencil className="size-4" />
            {updateAssetMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
