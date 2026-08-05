"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  Loader2,
  Paperclip,
  UploadCloud,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  completeFileRequestSubmission,
  getPublicFileRequest,
  submitFileToRequest,
  type PublicFileRequestView,
  type SubmitFileError,
} from "@/lib/api/file-requests"
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

type QueuedFile = {
  id: string
  file: File
  /** Stable across retries, so a lost response cannot create a second asset. */
  idempotencyKey: string
  status: "pending" | "uploading" | "done" | "error"
  progress: number
  error?: string
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

      setQueue((prev) => {
        const next = [...prev]
        for (const file of incoming) {
          // Local pre-checks are a courtesy so the sender sees the problem
          // before spending their upload. The server enforces all of this
          // again — a check that only runs in the browser is not a limit.
          if (request?.maxFileSizeBytes != null && file.size > request.maxFileSizeBytes) {
            next.push({
              id: newId(),
              file,
              idempotencyKey: newId(),
              status: "error",
              progress: 0,
              error: `Larger than the ${formatBytes(request.maxFileSizeBytes)} limit.`,
            })
            continue
          }
          next.push({
            id: newId(),
            file,
            idempotencyKey: newId(),
            status: "pending",
            progress: 0,
          })
        }
        return next
      })
    },
    [request],
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
            setQueue([])
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
  const canSubmit = pending.length > 0 && !submitting

  async function handleSubmit() {
    setFormError(null)

    if (request!.requireName && !submitterName.trim()) {
      setFormError("Your name is required.")
      return
    }
    if (request!.requireEmail && !submitterEmail.trim()) {
      setFormError("Your email address is required.")
      return
    }
    if (request!.requiresAccessCode && !accessCode.trim()) {
      setFormError("An access code is required.")
      return
    }

    setSubmitting(true)

    for (const item of queue) {
      if (item.status !== "pending") continue

      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "uploading", progress: 0 } : q)),
      )

      try {
        const result = await submitFileToRequest(
          token,
          {
            file: item.file,
            submissionId: submissionIdRef.current,
            submitterName: submitterName.trim() || null,
            submitterEmail: submitterEmail.trim() || null,
            accessCode: accessCode.trim() || null,
            idempotencyKey: item.idempotencyKey,
          },
          (fraction) => {
            setQueue((prev) =>
              prev.map((q) => (q.id === item.id ? { ...q, progress: fraction } : q)),
            )
          },
        )

        // Every file after the first joins the same submission, so the owner
        // gets one notification for the whole drop rather than one per file.
        submissionIdRef.current = result.submissionId

        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "done", progress: 1 } : q)),
        )
      } catch (err) {
        const failure = err as SubmitFileError
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: "error", error: failure?.message ?? "Upload failed." }
              : q,
          ),
        )

        // A rejection that applies to the whole request — a bad code, an
        // expiry, an exhausted quota — will reject every remaining file too.
        if (
          failure?.code === "ACCESS_CODE_INVALID" ||
          failure?.code === "REQUEST_EXPIRED" ||
          failure?.code === "REQUEST_REVOKED" ||
          failure?.code === "REQUEST_LIMIT_REACHED"
        ) {
          setFormError(failure.message)
          break
        }
      }
    }

    setSubmitting(false)

    if (submissionIdRef.current) {
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
        {request.maxFileSizeBytes != null ? (
          <>
            <dt className="text-muted-foreground">Max per file</dt>
            <dd className="text-right text-foreground">
              {formatBytes(request.maxFileSizeBytes)}
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
          {queue.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-foreground">
                  {item.file.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {item.status === "error"
                    ? item.error
                    : item.status === "done"
                      ? "Sent"
                      : item.status === "uploading"
                        ? `${Math.round(item.progress * 100)}%`
                        : formatBytes(item.file.size)}
                </p>
                {item.status === "uploading" ? (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>
              {item.status === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-primary" />
              ) : item.status === "error" ? (
                <AlertCircle className="size-4 shrink-0 text-destructive" />
              ) : item.status === "uploading" ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <button
                  type="button"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
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
          ? "Sending…"
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
