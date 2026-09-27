"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  Loader2,
  Paperclip,
  Pause,
  Play,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  completeFileRequestSubmission,
  getPublicFileRequest,
  type PublicFileRequestView,
} from "@/lib/api/file-requests"
import {
  UploadHttpError,
  UploadPausedError,
  UploadStalledError,
  fileFingerprint,
  forgetUpload,
  httpTransport,
  recallUpload,
  rememberUpload,
  runResumableUpload,
  type FileMeta,
} from "@/lib/uploads/resumable-upload"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

/**
 * The public File Request page.
 *
 * Deliberately shows nothing about the destination beyond what the owner wrote:
 * no folder contents, no counts of what is already there, no library
 * navigation. Everything rendered here comes from the public projection the API
 * builds, which carries no internal identifier at all.
 */

type ItemStatus =
  | "pending"
  | "uploading"
  | "reconnecting"
  | "verifying"
  | "paused"
  | "stalled"
  | "done"
  | "error"
  | "cancelled"

type QueuedFile = {
  id: string
  file: File
  status: ItemStatus
  uploadedBytes: number
  /** Bytes per second, smoothed. */
  speed: number | null
  error?: string
  uploadId?: string
}

/** Files uploading at once. More than this just splits the same bandwidth. */
const MAX_PARALLEL_FILES = 2

/** Failures that mean the whole link is closed, not just this file. */
const LINK_WIDE_CODES = new Set([
  "ACCESS_CODE_INVALID",
  "REQUEST_EXPIRED",
  "REQUEST_REVOKED",
  "REQUEST_LIMIT_REACHED",
])

function metaOf(file: File): FileMeta {
  return {
    filename: file.name,
    sizeBytes: file.size,
    mimeType: file.type || null,
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  if (seconds < 60) return `${Math.ceil(seconds)}s left`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min left`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function StateScreen({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/40">{icon}</div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

export function PublicFileRequestPage({ token }: { token: string }) {
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [submitterName, setSubmitterName] = useState("")
  const [submitterEmail, setSubmitterEmail] = useState("")
  const [accessCode, setAccessCode] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState<{ fileCount: number; totalBytes: number } | null>(null)

  const submissionIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const controllersRef = useRef(new Map<string, AbortController>())
  // The upload loop reads the queue between awaits, before React has
  // re-rendered, so the ref is the source of truth and state mirrors it. A ref
  // synced in an effect lagged one render behind: the last file still looked
  // "verifying" when the loop finished, and the submission was never closed.
  const queueRef = useRef<QueuedFile[]>([])
  const updateQueue = useCallback((change: (prev: QueuedFile[]) => QueuedFile[]) => {
    queueRef.current = change(queueRef.current)
    setQueue(queueRef.current)
  }, [])

  const {
    data: request,
    isLoading,
    error,
  } = useQuery<PublicFileRequestView>({
    queryKey: ["public-file-request", token],
    queryFn: ({ signal }) => getPublicFileRequest(token, signal),
    retry: false,
  })

  const accept = useMemo(() => {
    if (!request || request.allowedExtensions.length === 0) return undefined
    return request.allowedExtensions.map((ext) => `.${ext}`).join(",")
  }, [request])

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files)
      if (incoming.length === 0) return

      updateQueue((prev) => {
        const next = [...prev]
        for (const file of incoming) {
          // Local pre-checks are a courtesy so the sender sees the problem
          // before spending their upload. The server enforces all of this
          // again — a check that only runs in the browser is not a limit.
          const limit = request?.upload?.maximumUploadBytes ?? request?.maxFileSizeBytes ?? null
          if (limit != null && file.size > limit) {
            next.push({
              id: newId(),
              file,
              status: "error",
              uploadedBytes: 0,
              speed: null,
              error: `Larger than the ${formatBytes(limit)} limit.`,
            })
            continue
          }
          next.push({ id: newId(), file, status: "pending", uploadedBytes: 0, speed: null })
        }
        return next
      })
    },
    [request, updateQueue],
  )

  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault()
    window.addEventListener("dragover", prevent)
    window.addEventListener("drop", prevent)
    return () => {
      window.removeEventListener("dragover", prevent)
      window.removeEventListener("drop", prevent)
    }
  }, [])

  if (isLoading) {
    return (
      <StateScreen
        icon={<Loader2 className="size-6 animate-spin text-muted-foreground" />}
        title="Loading"
        body="Checking this upload link."
      />
    )
  }

  if (error || !request) {
    // One screen for every unavailable reason: a recipient must not be able to
    // tell "no such link" from "the owner deleted the folder behind it".
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message)
        : "This upload link is not available."
    return (
      <StateScreen
        icon={<AlertCircle className="size-6 text-muted-foreground" />}
        title="Link unavailable"
        body={message}
      />
    )
  }

  if (confirmed) {
    return (
      <div
        className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
        data-testid="file-request-success"
      >
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
          <CheckCircle2 className="size-7 text-primary" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Files sent</h1>
        <p className="text-[13px] text-muted-foreground">
          {confirmed.fileCount} file{confirmed.fileCount === 1 ? "" : "s"} ·{" "}
          {formatBytes(confirmed.totalBytes)} delivered to {request.title}.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setConfirmed(null)
            updateQueue(() => [])
            submissionIdRef.current = null
          }}
        >
          Send more files
        </Button>
      </div>
    )
  }

  const pending = queue.filter((q) => q.status === "pending")
  const uploaded = queue.filter((q) => q.status === "done")
  const active = queue.filter((q) =>
    ["uploading", "reconnecting", "verifying"].includes(q.status),
  )
  const canSubmit = pending.length > 0 && !submitting
  const maximumUploadBytes = request.upload?.maximumUploadBytes ?? request.maxFileSizeBytes

  const patch = (id: string, change: Partial<QueuedFile>) =>
    updateQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...change } : q)))

  /** Upload one file to completion, or until it pauses, stalls or fails. */
  async function uploadOne(item: QueuedFile): Promise<void> {
    const controller = new AbortController()
    controllersRef.current.set(item.id, controller)
    const meta = metaOf(item.file)
    const fingerprint = fileFingerprint(token, meta)
    let lastBytes = item.uploadedBytes
    let lastAt = performance.now()

    patch(item.id, { status: "uploading", error: undefined })
    try {
      const result = await runResumableUpload({
        file: item.file,
        meta,
        transport: httpTransport(token),
        extra: {
          submissionId: submissionIdRef.current,
          submitterName: submitterName.trim() || null,
          submitterEmail: submitterEmail.trim() || null,
          accessCode: accessCode.trim() || null,
        },
        knownUploadId: item.uploadId ?? recallUpload(fingerprint),
        submissionId: () => submissionIdRef.current,
        signal: controller.signal,
        onSession: (session) => {
          rememberUpload(fingerprint, session.uploadId)
          patch(item.id, { uploadId: session.uploadId, uploadedBytes: session.uploadedBytes })
        },
        onState: (state) => {
          if (state === "reconnecting") patch(item.id, { status: "reconnecting" })
          else if (state === "uploading") patch(item.id, { status: "uploading" })
          else if (state === "verifying") patch(item.id, { status: "verifying" })
        },
        onProgress: (bytes) => {
          const now = performance.now()
          const elapsed = (now - lastAt) / 1000
          if (elapsed >= 0.5) {
            const instant = Math.max(0, bytes - lastBytes) / elapsed
            lastBytes = bytes
            lastAt = now
            updateQueue((prev) =>
              prev.map((q) =>
                q.id === item.id
                  ? { ...q, uploadedBytes: bytes, speed: q.speed == null ? instant : q.speed * 0.7 + instant * 0.3 }
                  : q,
              ),
            )
          } else {
            patch(item.id, { uploadedBytes: bytes })
          }
        },
      })
      // Later files join this submission, so the owner is told once per drop.
      if (result.submissionId) submissionIdRef.current = result.submissionId
      forgetUpload(fingerprint)
      patch(item.id, { status: "done", uploadedBytes: item.file.size, speed: null })
    } catch (err) {
      if (err instanceof UploadPausedError || controller.signal.aborted) {
        const reason = controller.signal.reason
        if (reason === "cancel") {
          forgetUpload(fingerprint)
          patch(item.id, { status: "cancelled", speed: null })
        } else {
          patch(item.id, { status: "paused", speed: null })
        }
      } else if (err instanceof UploadStalledError) {
        patch(item.id, {
          status: "stalled",
          speed: null,
          error: "Unable to reconnect. Your progress is saved.",
        })
      } else {
        const failure = err instanceof UploadHttpError ? err : null
        if (failure && ["UPLOAD_SESSION_EXPIRED", "UPLOAD_NOT_FOUND"].includes(failure.code)) {
          forgetUpload(fingerprint)
        }
        patch(item.id, {
          status: "error",
          speed: null,
          uploadId: failure?.code === "UPLOAD_SESSION_EXPIRED" ? undefined : item.uploadId,
          error: failure?.message ?? "Upload failed.",
        })
        if (failure && LINK_WIDE_CODES.has(failure.code)) {
          setFormError(failure.message)
          throw failure
        }
      }
    } finally {
      controllersRef.current.delete(item.id)
    }
  }

  /** Work through queued files, MAX_PARALLEL_FILES at a time. */
  async function drain(ids: string[]) {
    const waiting = [...ids]
    let stopAll = false
    const worker = async () => {
      while (!stopAll && waiting.length > 0) {
        const id = waiting.shift()!
        const item = queueRef.current.find((q) => q.id === id)
        if (!item) continue
        try {
          await uploadOne(item)
        } catch {
          stopAll = true
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_FILES, waiting.length) }, worker))
  }

  function validateSubmitter(): boolean {
    setFormError(null)
    if (request!.requireName && !submitterName.trim()) {
      setFormError("Your name is required.")
      return false
    }
    if (request!.requireEmail && !submitterEmail.trim()) {
      setFormError("Your email address is required.")
      return false
    }
    if (request!.requiresAccessCode && !accessCode.trim()) {
      setFormError("An access code is required.")
      return false
    }
    return true
  }

  async function finish() {
    const stillBusy = queueRef.current.some((q) =>
      ["uploading", "reconnecting", "verifying", "pending"].includes(q.status),
    )
    const unfinished = queueRef.current.some((q) => ["paused", "stalled"].includes(q.status))
    if (stillBusy || unfinished || !submissionIdRef.current) return
    try {
      const summary = await completeFileRequestSubmission(token, submissionIdRef.current)
      if (summary.fileCount > 0) {
        setConfirmed({ fileCount: summary.fileCount, totalBytes: summary.totalBytes })
      }
    } catch {
      // The files are already stored; failing to close the submission is not
      // worth showing the sender an error about.
    }
  }

  async function run(ids: string[]) {
    setSubmitting(true)
    try {
      await drain(ids)
    } finally {
      setSubmitting(false)
    }
    await finish()
  }

  async function handleSubmit() {
    if (!validateSubmitter()) return
    await run(queue.filter((q) => q.status === "pending").map((q) => q.id))
  }

  function pauseItem(id: string) {
    controllersRef.current.get(id)?.abort("pause")
  }

  async function cancelItem(item: QueuedFile) {
    const controller = controllersRef.current.get(item.id)
    if (controller) controller.abort("cancel")
    if (item.uploadId) await httpTransport(token).cancel(item.uploadId)
    forgetUpload(fileFingerprint(token, metaOf(item.file)))
    patch(item.id, { status: "cancelled", speed: null })
  }

  async function resumeItem(id: string) {
    if (!validateSubmitter()) return
    patch(id, { status: "pending" })
    await run([id])
  }

  return (
    <div className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <header className="mb-6">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Inbox className="size-3.5 text-primary" />
          File request
        </div>
        <h1 className="text-xl font-semibold text-foreground">{request.title}</h1>
        {request.message ? (
          <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
            {request.message}
          </p>
        ) : null}
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border bg-card/40 p-4 text-[12px]">
        {request.expiresAt ? (
          <>
            <dt className="text-muted-foreground">Open until</dt>
            <dd className="text-right text-foreground">
              {new Date(request.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </dd>
          </>
        ) : null}
        {request.allowedExtensions.length > 0 || request.allowedMediaTypes.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Accepted</dt>
            <dd className="text-right text-foreground">
              {request.allowedExtensions.length > 0
                ? request.allowedExtensions.join(", ")
                : request.allowedMediaTypes.join(", ").toLowerCase()}
            </dd>
          </>
        ) : null}
        {maximumUploadBytes != null ? (
          <>
            <dt className="text-muted-foreground">Max per file</dt>
            <dd className="text-right text-foreground" data-testid="file-request-max-size">
              {formatBytes(maximumUploadBytes)}
            </dd>
          </>
        ) : null}
        {request.remainingFileCount != null ? (
          <>
            <dt className="text-muted-foreground">Files you can send</dt>
            <dd className="text-right text-foreground">{request.remainingFileCount}</dd>
          </>
        ) : null}
        {request.remainingBytes != null ? (
          <>
            <dt className="text-muted-foreground">Space left</dt>
            <dd className="text-right text-foreground">{formatBytes(request.remainingBytes)}</dd>
          </>
        ) : null}
      </dl>

      {request.requireName || request.requireEmail || request.requiresAccessCode ? (
        <div className="mb-4 space-y-3">
          {request.requireName ? (
            <div>
              <label
                htmlFor="fr-submitter-name"
                className="mb-1 block text-[12px] font-medium text-foreground"
              >
                Your name
              </label>
              <Input
                id="fr-submitter-name"
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                data-testid="file-request-name"
              />
            </div>
          ) : null}
          {request.requireEmail ? (
            <div>
              <label
                htmlFor="fr-submitter-email"
                className="mb-1 block text-[12px] font-medium text-foreground"
              >
                Your email
              </label>
              <Input
                id="fr-submitter-email"
                type="email"
                value={submitterEmail}
                onChange={(e) => setSubmitterEmail(e.target.value)}
                data-testid="file-request-email"
              />
            </div>
          ) : null}
          {request.requiresAccessCode ? (
            <div>
              <label
                htmlFor="fr-access-code"
                className="mb-1 block text-[12px] font-medium text-foreground"
              >
                Access code
              </label>
              <Input
                id="fr-access-code"
                type="password"
                autoComplete="off"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                data-testid="file-request-code"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        data-testid="file-request-dropzone"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/20 hover:border-primary/40",
        )}
      >
        <UploadCloud className="size-7 text-primary" />
        <p className="text-[13px] font-medium text-foreground">Drop files here</p>
        <p className="text-[12px] text-muted-foreground">or click to choose from your device</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          data-testid="file-request-input"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {queue.length > 0 ? (
        <ul className="mt-4 space-y-2" data-testid="file-request-queue">
          {queue.map((item) => {
            const fraction = item.file.size > 0 ? item.uploadedBytes / item.file.size : 1
            const percent = Math.min(100, Math.floor(fraction * 100))
            const inFlight = ["uploading", "reconnecting", "verifying"].includes(item.status)
            const showBar = inFlight || item.status === "paused" || item.status === "stalled"
            const remaining = item.speed && item.speed > 0 ? (item.file.size - item.uploadedBytes) / item.speed : NaN
            const label =
              item.status === "error"
                ? item.error
                : item.status === "done"
                  ? `Sent · ${formatBytes(item.file.size)}`
                  : item.status === "cancelled"
                    ? "Cancelled"
                    : item.status === "pending"
                      ? formatBytes(item.file.size)
                      : item.status === "reconnecting"
                        ? "Connection interrupted. Retrying…"
                        : item.status === "verifying"
                          ? "Verifying…"
                          : item.status === "paused"
                            ? `Paused · ${formatBytes(item.uploadedBytes)} / ${formatBytes(item.file.size)}`
                            : item.status === "stalled"
                              ? item.error
                              : [
                                  `${formatBytes(item.uploadedBytes)} / ${formatBytes(item.file.size)}`,
                                  `${percent}%`,
                                  item.speed ? `${formatBytes(item.speed)}/s` : null,
                                  formatDuration(remaining) || null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
            return (
              <li
                key={item.id}
                data-testid="file-request-item"
                data-status={item.status}
                className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2"
              >
                <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-foreground">{item.file.name}</p>
                  <p className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
                    {label}
                  </p>
                  {showBar ? (
                    <div
                      className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`${item.file.name} upload progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <div
                        className={cn(
                          "h-full transition-[width]",
                          item.status === "stalled" || item.status === "reconnecting" ? "bg-amber-500" : "bg-primary",
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.status === "done" ? <CheckCircle2 className="size-4 text-primary" /> : null}
                  {item.status === "error" ? <AlertCircle className="size-4 text-destructive" /> : null}
                  {inFlight ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                  {item.status === "uploading" ? (
                    <button
                      type="button"
                      aria-label={`Pause ${item.file.name}`}
                      onClick={() => pauseItem(item.id)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pause className="size-4" />
                    </button>
                  ) : null}
                  {item.status === "paused" || item.status === "stalled" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => void resumeItem(item.id)}
                      data-testid="file-request-resume"
                    >
                      <Play className="size-3" />
                      Resume upload
                    </Button>
                  ) : null}
                  {item.status === "error" && item.uploadId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => void resumeItem(item.id)}
                      data-testid="file-request-retry"
                    >
                      <RotateCcw className="size-3" />
                      Retry
                    </Button>
                  ) : null}
                  {item.status === "pending" || item.status === "error" || item.status === "cancelled" ? (
                    <button
                      type="button"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => updateQueue((prev) => prev.filter((q) => q.id !== item.id))}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                  {inFlight || item.status === "paused" || item.status === "stalled" ? (
                    <button
                      type="button"
                      aria-label={`Cancel ${item.file.name}`}
                      onClick={() => void cancelItem(item)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      data-testid="file-request-cancel"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {formError ? (
        <p
          className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
          data-testid="file-request-error"
        >
          {formError}
        </p>
      ) : null}

      <Button
        type="button"
        className="mt-5 w-full gap-2"
        disabled={!canSubmit}
        onClick={() => void handleSubmit()}
        data-testid="file-request-submit"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
        {submitting
          ? `Sending${active.length > 1 ? ` ${active.length} files` : ""}…`
          : pending.length > 0
            ? `Send ${pending.length} file${pending.length === 1 ? "" : "s"}`
            : uploaded.length > 0
              ? "All files sent"
              : "Choose files to send"}
      </Button>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        Your files go straight to the person who sent you this link. You can&apos;t see anything
        else on their server, and nobody else can see what you upload.
      </p>
    </div>
  )
}
