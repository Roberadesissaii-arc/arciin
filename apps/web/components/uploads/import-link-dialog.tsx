"use client"
/* eslint-disable react-hooks/set-state-in-effect -- intentional: sync the selected format when the resolved link preview or audio-only toggle changes. */

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  FileText,
  Film,
  Info,
  Loader2,
  Music2,
  Link2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react"

import { IMPORT_BATCH_MAX_ITEMS, normalizeImportUrl } from "@arciin/shared"

import { notifyImportFailed, notifyImportStarted } from "@/lib/notifications/toast-actions"
import { useUploadStore } from "@/lib/stores/upload-store"

import { ImportLinkCandidates, ImportLinkSingleItem } from "@/components/uploads/import-link-candidates"
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
import { libraryInspectorPanel } from "@/lib/library-glass-sheet"
import { ApiError } from "@/lib/api/errors"
import { importFromUrl, importInspectionItems, inspectImportLink } from "@/lib/api/imports"
import { queryKeys } from "@/lib/api/query-keys"
import {
  VIDEO_FORMATS,
  analyzeImportLink,
  formatToImportOptions,
  type LinkImportFormatId,
  type LinkImportPreview,
} from "@/lib/utils/link-import-preview"
import { importSheetPhase, type ImportSheetPhase } from "@/lib/utils/import-sheet-phase"
import { cn } from "@/lib/utils"

const SUPPORTED = [
  { icon: Video, label: "Videos" },
  { icon: Music2, label: "Music & audio" },
  { icon: FileText, label: "PDFs & docs" },
  { icon: Film, label: "Direct files" },
] as const

/** Shown, disabled, before a link offers any format — so the card never changes shape. */
const PLACEHOLDER_VIDEO_FORMATS = [
  { id: "video-mp4" as LinkImportFormatId, label: "MP4 video", subtitle: "Full video with audio", live: false },
  { id: "video-best" as LinkImportFormatId, label: "Best quality", subtitle: "Highest quality available", live: false },
]
const PLACEHOLDER_AUDIO_FORMATS = [
  { id: "audio-mp3" as LinkImportFormatId, label: "MP3 audio", subtitle: "Extract soundtrack as MP3", live: false },
  { id: "audio-m4a" as LinkImportFormatId, label: "M4A audio", subtitle: "Extract soundtrack as M4A", live: false },
]

const VIDEO_FORMAT_IDS: LinkImportFormatId[] = ["video-mp4", "video-best"]
const AUDIO_FORMAT_IDS: LinkImportFormatId[] = ["audio-mp3", "audio-m4a"]

const glassInput =
  "h-10 border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/20"

const headerControlH = "h-10"
const floatChip =
  "pointer-events-auto rounded-xl border border-border bg-card shadow-sm ring-1 ring-black/[0.04] backdrop-blur-xl"

/** Wait this long after typing stops before asking the server to inspect a link. */
const INSPECT_DEBOUNCE_MS = 600

const PHASE_STATUS: Partial<Record<ImportSheetPhase, string>> = {
  preparing: "Preparing link…",
  inspecting: "Inspecting page…",
  none: "No downloadable public media found on this page.",
  error: "Could not inspect this link.",
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
      data-selected={selected && !disabled ? "" : undefined}
      className={cn(
        "flex h-[4.5rem] flex-col items-start justify-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F12]/30",
        disabled
          ? "cursor-not-allowed border-zinc-200/70 bg-zinc-50/80 text-zinc-400"
          : selected
            ? "border-[#FF4F12]/45 bg-[#FF4F12]/[0.06] ring-1 ring-[#FF4F12]/20"
            : "border-zinc-200/90 bg-white hover:border-zinc-300 hover:bg-zinc-50/80",
      )}
    >
      <span className="flex w-full items-center gap-1.5">
        <Icon
          className={cn("size-3.5 shrink-0", selected && !disabled ? "text-[#FF4F12]" : "text-zinc-400")}
          aria-hidden
        />
        <span className={cn("truncate text-[12.5px] font-semibold", disabled ? "text-zinc-500" : "text-zinc-900")}>{title}</span>
      </span>
      <span className={cn("line-clamp-2 text-[11px] leading-snug", disabled ? "text-zinc-400" : "text-zinc-600")}>{subtitle}</span>
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
  const [inspectTarget, setInspectTarget] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  // The same normalisation the server applies: "example.com" → https://example.com/.
  const normalized = useMemo(() => normalizeImportUrl(url), [url])
  const effectiveUrl = normalized.ok ? normalized.url : null

  const preview = useMemo(
    () => (effectiveUrl ? analyzeImportLink(effectiveUrl) : null),
    [effectiveUrl],
  )
  const clientBlocked = Boolean(preview?.importBlocked)

  // Inspect once typing settles, never on every keystroke.
  useEffect(() => {
    if (!effectiveUrl || clientBlocked) {
      setInspectTarget(null)
      return
    }
    const timer = window.setTimeout(() => setInspectTarget(effectiveUrl), INSPECT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [effectiveUrl, clientBlocked])

  const inspectQuery = useQuery({
    queryKey: queryKeys.importInspection(inspectTarget ?? ""),
    queryFn: ({ signal }) => inspectImportLink(inspectTarget!, signal),
    enabled: open && Boolean(inspectTarget),
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
  const inspection = inspectTarget && inspectTarget === effectiveUrl ? inspectQuery.data : undefined
  // A refusal of the address itself (private network, not a web link) is a
  // "cannot import" with the server's reason, not a failed inspection.
  const inspectRefusal =
    inspectQuery.error instanceof ApiError &&
    (inspectQuery.error.code === "IMPORT_URL_BLOCKED" || inspectQuery.error.code === "VALIDATION_ERROR")
      ? inspectQuery.error.message
      : null

  const phase = importSheetPhase({
    text: url,
    normalizedOk: normalized.ok,
    clientBlocked,
    settled: Boolean(inspectTarget) && inspectTarget === effectiveUrl,
    inspection,
    inspecting: inspectQuery.isFetching,
    inspectFailed: inspectQuery.isError,
    inspectRefused: inspectRefusal != null,
  })
  const blockReason =
    preview?.blockReason ?? (inspection?.kind === "blocked" ? inspection.reason : null) ?? inspectRefusal
  const candidates = phase === "multiple" ? (inspection?.items ?? []) : []
  /** One inspected item: shown with its own title and preview. */
  const singleItem =
    inspection?.kind === "single" && phase !== "blocked" && inspection.items.length === 1 ? inspection.items[0]! : null
  const selectedCandidates = candidates.filter((item) => selectedIds.has(item.id))

  // A new inspection starts with nothing chosen.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [inspection?.inspectionId])

  // With several items, one output choice applies to the video items among
  // those chosen; anything else imports as it is.
  const anyVideoChosen = selectedCandidates.some((item) => item.category === "video")
  const formatSource: Pick<LinkImportPreview, "formats"> | null =
    phase === "multiple"
      ? { formats: anyVideoChosen || selectedCandidates.length === 0 ? VIDEO_FORMATS : [] }
      : preview
  const formatOptionsEnabled =
    phase === "multiple"
      ? anyVideoChosen
      : phase !== "blocked" && linkSupportsFormatOptions(preview)

  const videoFormats = formatSource?.formats.filter((f) => VIDEO_FORMAT_IDS.includes(f.id)) ?? []
  // Memoised: the effect below depends on this list, and a new array each
  // render would re-run it forever.
  const audioFormats = useMemo(
    () => formatSource?.formats.filter((f) => AUDIO_FORMAT_IDS.includes(f.id)) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, preview, anyVideoChosen, selectedCandidates.length],
  )

  const selectedFormat = useMemo(() => {
    if (!formatSource || formatSource.formats.length === 0) return null
    return formatSource.formats.find((f) => f.id === formatId) ?? formatSource.formats[0]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, preview, anyVideoChosen, formatId])

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
    setInspectTarget(null)
    setSelectedIds(new Set())
  }

  /** Show the full address once the person is done with the field — not while they type. */
  function normalizeField(value = url) {
    const result = normalizeImportUrl(value)
    if (result.ok && result.url !== value) setUrl(result.url)
  }

  function toggleCandidate(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < IMPORT_BATCH_MAX_ITEMS) next.add(id)
      return next
    })
  }

  function toggleAllCandidates() {
    setSelectedIds((prev) =>
      candidates.every((item) => prev.has(item.id))
        ? new Set()
        : new Set(candidates.slice(0, IMPORT_BATCH_MAX_ITEMS).map((item) => item.id)),
    )
  }

  async function submitBatch() {
    if (!inspection || selectedCandidates.length === 0) return
    const format = selectedFormat
    const importOptions = format && anyVideoChosen ? formatToImportOptions(format) : {}
    setSubmitting(true)
    try {
      const result = await importInspectionItems(
        inspection.inspectionId,
        selectedCandidates.map((item) => item.id),
        importOptions,
      )
      for (const { upload, state } of result.accepted) {
        useUploadStore.getState().addOrUpdate({
          id: upload.id,
          fileName: upload.originalFilename || inspection.url,
          mimeType: upload.mimeType ?? undefined,
          sizeBytes: Number(upload.sizeBytes) || 0,
          progress: state === "started" ? Math.max(upload.progress ?? 0, 12) : 0,
          status: state === "started" ? "UPLOADING" : "QUEUED",
          destination: upload.targetLibrary?.name ?? "Inbox",
          uploadId: upload.id,
        })
      }
      notifyImportStarted(undefined, `${result.accepted.length} item${result.accepted.length === 1 ? "" : "s"}`)
      if (result.rejected.length > 0) {
        notifyImportFailed(undefined, `${result.rejected.length} item${result.rejected.length === 1 ? " was" : "s were"} not imported: ${result.rejected[0]!.message}`)
      }
      resetForm()
      setOpen(false)
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Could not start the import."
      setError(message)
      notifyImportFailed(undefined, message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submit() {
    if (phase === "multiple") return submitBatch()
    // Defensive: normalise again at the moment of submitting.
    const result = normalizeImportUrl(url)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    const target = result.url

    const resolved = analyzeImportLink(target)
    if (resolved?.importBlocked || phase === "blocked") {
      setError(resolved?.blockReason ?? blockReason ?? "This link cannot be imported.")
      return
    }

    const format = selectedFormat ?? preview?.formats[0]
    const importOptions = format ? formatToImportOptions(format) : { audioOnly: false }

    setSubmitting(true)
    try {
      // A single inspected item: let the server name it from what it stored.
      const single =
        inspection?.kind === "single" && inspection.url === target && inspection.items[0]
          ? { inspectionId: inspection.inspectionId, itemId: inspection.items[0].id }
          : undefined
      const session = await importFromUrl(target, { ...importOptions, candidate: single })
      notifyImportStarted(preview?.source.key, preview?.source.label)
      useUploadStore.getState().addOrUpdate({
        id: session.id,
        fileName: session.originalFilename || target,
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

  const optionsHint =
    phase === "multiple"
      ? selectedCandidates.length === 0
        ? "Choose items, then one format for all of them."
        : anyVideoChosen
          ? selectedCandidates.every((item) => item.category === "video")
            ? "Applies to every selected video."
            : "Applies to the videos; other items import as they are."
          : "These items download as they are (no conversion)."
      : !preview
        ? "Paste a video link to unlock format choices."
        : phase === "blocked"
          ? "Format options are unavailable for this host."
          : formatOptionsEnabled
            ? audioOnlyEnabled
              ? "Audio only — pick MP3 or M4A."
              : "Full video or switch on Audio only."
            : "This link downloads as-is (no format conversion)."

  const submitDisabled =
    submitting ||
    !normalized.ok ||
    phase === "blocked" ||
    phase === "preparing" ||
    phase === "inspecting" ||
    (phase === "multiple" && selectedCandidates.length === 0)

  const submitLabel = submitting
    ? "Starting…"
    : phase === "blocked"
      ? preview?.importBlocked || inspection?.kind === "blocked"
        ? "Cannot import (DRM)"
        : "Cannot import this link"
      : phase === "multiple"
        ? selectedCandidates.length === 0
          ? "Select items to import"
          : `Import ${selectedCandidates.length} item${selectedCandidates.length === 1 ? "" : "s"}`
        : phase === "none" || phase === "error"
          ? "Try importing anyway"
          : preview
            ? `Import from ${preview.source.label}`
            : "Import link"

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
        className={cn(libraryInspectorPanel, "dashboard-main text-foreground")}
        data-testid="import-link-panel"
      >
        {/* 1. Header */}
        {/* Compact header — title + one short line (the v1.1.2 header) */}
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
          {/* 2. Link */}
          <Field className="min-w-0 gap-1.5">
            <FieldLabel htmlFor="importUrl" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              Link
            </FieldLabel>
            <Input
              id="importUrl"
              value={url}
              autoFocus
              inputMode="url"
              placeholder="Paste a link or enter example.com"
              autoComplete="off"
              spellCheck={false}
              data-testid="import-link-input"
              onChange={(event) => {
                setUrl(event.target.value)
                setError(undefined)
              }}
              onBlur={() => normalizeField()}
              onPaste={(event) => {
                // A whole link pasted into an empty (or fully selected) field is
                // shown in full at once; a paste mid-edit is left alone.
                const input = event.currentTarget
                const whole = input.selectionStart === 0 && input.selectionEnd === input.value.length
                const pasted = event.clipboardData.getData("text")
                const result = normalizeImportUrl(pasted)
                if (whole && result.ok) {
                  event.preventDefault()
                  setUrl(result.url)
                  setError(undefined)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !submitDisabled) {
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
            {PHASE_STATUS[phase] ? (
              <p
                role="status"
                data-testid="import-link-status"
                data-phase={phase}
                className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-snug text-zinc-600"
              >
                {phase === "preparing" || phase === "inspecting" ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : null}
                {PHASE_STATUS[phase]}
              </p>
            ) : null}
            {phase === "invalid" && !normalized.ok && url.trim().length > 3 ? (
              <p className="text-[11.5px] leading-snug text-zinc-600" data-testid="import-link-status" data-phase="invalid">
                {normalized.reason}
              </p>
            ) : null}
          </Field>

          {/* 3. Preview / candidates */}
          {phase === "multiple" && inspection ? (
            <ImportLinkCandidates
              inspectionId={inspection.inspectionId}
              title={inspection.title}
              items={candidates}
              selected={selectedIds}
              onToggle={toggleCandidate}
              onToggleAll={toggleAllCandidates}
              disabled={submitting}
            />
          ) : singleItem && inspection ? (
            <ImportLinkSingleItem inspectionId={inspection.inspectionId} item={singleItem} />
          ) : effectiveUrl ? (
            <ImportLinkInspectSlot url={effectiveUrl} />
          ) : null}

          {phase === "blocked" && blockReason ? (
            <div
              role="status"
              data-testid="import-link-blocked"
              className="min-w-0 break-words rounded-xl border border-amber-200/90 bg-amber-50 px-3 py-2.5 text-[12px] leading-snug text-amber-900"
            >
              {blockReason}
            </div>
          ) : null}

          {/* 4. Download options */}
          <section
            className={cn(
              "min-w-0 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-sm",
              phase === "blocked" && "opacity-60",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Download options
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{optionsHint}</p>
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

            <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Download format">
              {(videoFormats.length > 0
                ? videoFormats.map((format) => ({ ...format, live: true }))
                : PLACEHOLDER_VIDEO_FORMATS
              ).map((format) => (
                <FormatSlot
                  key={format.id}
                  selected={format.live && formatId === format.id}
                  disabled={!format.live || !formatOptionsEnabled || audioOnlyEnabled}
                  onSelect={() => {
                    setAudioOnlyEnabled(false)
                    setFormatId(format.id)
                  }}
                  icon={Video}
                  title={format.label}
                  subtitle={format.subtitle}
                />
              ))}
              {(audioFormats.length > 0
                ? audioFormats.map((format) => ({ ...format, live: true }))
                : PLACEHOLDER_AUDIO_FORMATS
              ).map((format) => (
                <FormatSlot
                  key={format.id}
                  selected={format.live && formatId === format.id}
                  disabled={!format.live || !formatOptionsEnabled || !audioOnlyEnabled}
                  onSelect={() => {
                    setAudioOnlyEnabled(true)
                    setFormatId(format.id)
                  }}
                  icon={Music2}
                  title={format.label}
                  subtitle={format.subtitle}
                />
              ))}
            </div>
          </section>

          {/* 5. Supported sources (the v1.1.2 card) */}
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

          {/* Anchored at the bottom of the body: the panel is full height, so any
              room left over reads as breathing space above a short note rather
              than an empty column. */}
          <div className="mt-auto flex gap-2.5 rounded-xl px-1 pt-2 text-[11.5px] leading-snug text-zinc-500" data-testid="import-link-help">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              Your server downloads the file, names it after its source and files it into the right
              library. Previews are fetched by your server too — this page never contacts the source
              site.
            </p>
          </div>
        </div>

        {/* 6. Footer */}
        <SheetFooter className="shrink-0 border-t border-border p-3">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={submitDisabled}
            onClick={() => void submit()}
            data-testid="import-link-submit"
          >
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
