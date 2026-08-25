"use client"
/* eslint-disable react-hooks/set-state-in-effect -- intentional: sync the selected format when the resolved link preview or audio-only toggle changes. */

import { useEffect, useMemo, useState } from "react"
import {
  FileText,
  Film,
  Music2,
  Link2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react"

import { notifyImportFailed, notifyImportStarted } from "@/lib/notifications/toast-actions"
import { useUploadStore } from "@/lib/stores/upload-store"

import {
  ImportLinkInspectSlot,
  linkSupportsFormatOptions,
} from "@/components/uploads/import-link-preview"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { importFromUrl } from "@/lib/api/imports"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import {
  analyzeImportLink,
  formatToImportOptions,
  type LinkImportFormatId,
} from "@/lib/utils/link-import-preview"
import { cn } from "@/lib/utils"

const SUPPORTED = [
  { icon: Video, label: "Videos" },
  { icon: Music2, label: "Music & audio" },
  { icon: FileText, label: "PDFs & docs" },
  { icon: Film, label: "Direct files" },
] as const

const VIDEO_FORMAT_IDS: LinkImportFormatId[] = ["video-mp4", "video-best"]
const AUDIO_FORMAT_IDS: LinkImportFormatId[] = ["audio-mp3", "audio-m4a"]

const glassInput =
  "h-10 border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/20"

const headerControlH = "h-10"
const floatChip =
  "pointer-events-auto rounded-xl border border-border bg-card shadow-sm ring-1 ring-black/[0.04] backdrop-blur-xl"

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function FormatSlot({
  selected,
  disabled,
  onSelect,
  icon: Icon,
  title,
  subtitle,
}: {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[4.25rem] flex-col justify-center gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
        disabled && "cursor-not-allowed opacity-40",
        !disabled && selected
          ? "border-primary/45 bg-primary/[0.07] ring-1 ring-primary/25"
          : !disabled && "border-zinc-200/90 bg-white hover:border-zinc-300 hover:bg-zinc-50/80",
        disabled && "border-zinc-200/70 bg-zinc-50/80",
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            selected && !disabled ? "text-primary" : "text-zinc-400",
          )}
        />
        <span className="truncate text-[12px] font-semibold text-zinc-900">{title}</span>
      </span>
      <span className="line-clamp-2 text-[10px] leading-snug text-zinc-500">{subtitle}</span>
    </button>
  )
}

/** Header action: paste a public link (YouTube, image, PDF, …) → server imports + classifies it. */
export function ImportLinkDialog() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [formatId, setFormatId] = useState<LinkImportFormatId>("video-mp4")
  const [audioOnlyEnabled, setAudioOnlyEnabled] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  const preview = useMemo(
    () => (looksLikeUrl(url) ? analyzeImportLink(url.trim()) : null),
    [url],
  )

  const formatOptionsEnabled = linkSupportsFormatOptions(preview)

  const videoFormats = preview?.formats.filter((f) => VIDEO_FORMAT_IDS.includes(f.id)) ?? []
  // Memoised: the effect below depends on this list, and a new array each
  // render would re-run it forever.
  const audioFormats = useMemo(
    () => preview?.formats.filter((f) => AUDIO_FORMAT_IDS.includes(f.id)) ?? [],
    [preview],
  )

  const selectedFormat = useMemo(() => {
    if (!preview) return null
    return preview.formats.find((f) => f.id === formatId) ?? preview.formats[0]
  }, [preview, formatId])

  useEffect(() => {
    if (!preview) return
    setFormatId(preview.defaultFormatId)
    setAudioOnlyEnabled(false)
    setError(undefined)
  // Keyed on the link, not the preview object: this resets the form for a
  // *different* link. Re-running it whenever a preview is refetched would
  // discard the format the user had just chosen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.source.href])

  useEffect(() => {
    if (!audioOnlyEnabled || audioFormats.length === 0) return
    if (!AUDIO_FORMAT_IDS.includes(formatId)) {
      setFormatId(audioFormats[0]?.id ?? "audio-mp3")
    }
  }, [audioOnlyEnabled, audioFormats, formatId])

  function resetForm() {
    setUrl("")
    setFormatId("video-mp4")
    setAudioOnlyEnabled(false)
    setError(undefined)
  }

  async function submit() {
    const trimmed = url.trim()
    if (!looksLikeUrl(trimmed)) {
      setError("Enter a valid link starting with http:// or https://")
      return
    }

    const resolved = looksLikeUrl(trimmed) ? analyzeImportLink(trimmed) : null
    if (resolved?.importBlocked) {
      setError(resolved.blockReason ?? "This link cannot be imported.")
      return
    }

    const format = selectedFormat ?? preview?.formats[0]
    const importOptions = format ? formatToImportOptions(format) : { audioOnly: false }

    setSubmitting(true)
    try {
      const session = await importFromUrl(trimmed, importOptions)
      notifyImportStarted(preview?.source.key, preview?.source.label)
      useUploadStore.getState().addOrUpdate({
        id: session.id,
        fileName: session.originalFilename || trimmed,
        mimeType: session.mimeType ?? undefined,
        sizeBytes: Number(session.sizeBytes) || 0,
        progress: Math.max(session.progress ?? 0, 12),
        status: session.status === "FAILED" ? "FAILED" : "UPLOADING",
        destination:
          preview?.destinationLibrary ?? session.targetLibrary?.name ?? "Inbox",
        uploadId: session.id,
      })
      resetForm()
      setOpen(false)
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Could not start the import."
      setError(message)
      notifyImportFailed(undefined, message, preview?.source.key)
    } finally {
      setSubmitting(false)
    }
  }

  const optionsHint = !preview
    ? "Paste a video link to unlock format choices."
    : preview.importBlocked
      ? "Format options are unavailable for this host."
      : formatOptionsEnabled
        ? audioOnlyEnabled
          ? "Audio only — pick MP3 or M4A."
          : "Full video or switch on Audio only."
        : "This link downloads as-is (no format conversion)."

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Import from link"
          title="Import from link"
          className={cn(
            floatChip,
            headerControlH,
            "w-10 shrink-0 border-border bg-card text-[color:var(--arciin-accent,#ff4f12)] hover:bg-zinc-50/90 hover:text-[color:var(--arciin-accent-hover,#ff6a33)]",
            "dark:border-border dark:bg-card dark:hover:bg-zinc-50/90",
          )}
        >
          <Link2 className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
      >
        {/* Compact header — title + one short line, no overflow from long copy */}
        <SheetHeader className="relative shrink-0 space-y-2 border-b border-border px-3 py-3 pr-11">
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2.5 right-2 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-[color:var(--arciin-accent,#ff4f12)]">
              <Link2 className="size-4" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <SheetTitle className="font-heading text-[17px] font-semibold tracking-tight text-zinc-900">
                Import from link
              </SheetTitle>
              <SheetDescription className="text-[12.5px] leading-snug text-zinc-500">
                Public links only — YouTube, SoundCloud, TikTok, files. Not Spotify or Audible.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-3">
          <Field className="min-w-0 gap-1.5">
            <FieldLabel
              htmlFor="importUrl"
              className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
            >
              Link
            </FieldLabel>
            <Input
              id="importUrl"
              value={url}
              autoFocus
              inputMode="url"
              placeholder="https://…"
              onChange={(event) => {
                setUrl(event.target.value)
                setError(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !submitting) {
                  event.preventDefault()
                  void submit()
                }
              }}
              className={glassInput}
            />
            {error ? (
              <p
                role="alert"
                className="break-words rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11.5px] leading-snug text-red-700"
              >
                {error}
              </p>
            ) : null}
          </Field>

          <ImportLinkInspectSlot url={url.trim()} />

          {preview?.importBlocked && preview.blockReason ? (
            <div
              role="status"
              className="min-w-0 break-words rounded-xl border border-amber-200/90 bg-amber-50 px-3 py-2.5 text-[12px] leading-snug text-amber-900"
            >
              {preview.blockReason}
            </div>
          ) : null}

          {/* Download options — no fixed height that clips or overflows long hints */}
          <section
            className={cn(
              "min-w-0 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-sm",
              preview?.importBlocked && "opacity-60",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Download options
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">{optionsHint}</p>
              </div>
              <div
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1",
                  !formatOptionsEnabled && "opacity-40",
                )}
              >
                <Checkbox
                  id="audioOnlyToggle"
                  checked={audioOnlyEnabled}
                  disabled={!formatOptionsEnabled}
                  onCheckedChange={(checked) => setAudioOnlyEnabled(checked === true)}
                />
                <Label
                  htmlFor="audioOnlyToggle"
                  className={cn(
                    "text-[11.5px] font-semibold text-zinc-700",
                    formatOptionsEnabled ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  Audio only
                </Label>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {videoFormats.length > 0
                ? videoFormats.map((format) => (
                    <FormatSlot
                      key={format.id}
                      selected={formatId === format.id}
                      disabled={!formatOptionsEnabled || audioOnlyEnabled}
                      onSelect={() => {
                        setAudioOnlyEnabled(false)
                        setFormatId(format.id)
                      }}
                      icon={Video}
                      title={format.label}
                      subtitle={format.subtitle}
                    />
                  ))
                : [
                    { id: "video-mp4", label: "MP4 video", subtitle: "Full video with audio" },
                    { id: "video-best", label: "Best quality", subtitle: "Highest quality available" },
                  ].map((slot) => (
                    <FormatSlot
                      key={slot.id}
                      selected={false}
                      disabled
                      onSelect={() => {}}
                      icon={Video}
                      title={slot.label}
                      subtitle={slot.subtitle}
                    />
                  ))}

              {audioFormats.length > 0
                ? audioFormats.map((format) => (
                    <FormatSlot
                      key={format.id}
                      selected={formatId === format.id}
                      disabled={!formatOptionsEnabled || !audioOnlyEnabled}
                      onSelect={() => {
                        setAudioOnlyEnabled(true)
                        setFormatId(format.id)
                      }}
                      icon={Music2}
                      title={format.label}
                      subtitle={format.subtitle}
                    />
                  ))
                : [
                    { id: "audio-mp3", label: "MP3 audio", subtitle: "Extract soundtrack as MP3" },
                    { id: "audio-m4a", label: "M4A audio", subtitle: "Extract soundtrack as M4A" },
                  ].map((slot) => (
                    <FormatSlot
                      key={slot.id}
                      selected={false}
                      disabled
                      onSelect={() => {}}
                      icon={Music2}
                      title={slot.label}
                      subtitle={slot.subtitle}
                    />
                  ))}
            </div>
          </section>

          <div className="shrink-0 overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50/80 p-3">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Supported sources
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {SUPPORTED.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-2.5 py-2 text-[12px] font-medium text-zinc-700"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                    <Icon className="size-3.5" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <SheetFooter className="shrink-0 border-t border-border p-3">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={submitting || !looksLikeUrl(url) || Boolean(preview?.importBlocked)}
            onClick={() => void submit()}
          >
            {submitting
              ? "Starting…"
              : preview?.importBlocked
                ? "Cannot import (DRM)"
                : preview
                  ? `Import from ${preview.source.label}`
                  : "Import link"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
