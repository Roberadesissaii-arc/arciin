"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Check, Copy, ExternalLink, Inbox, Loader2 } from "lucide-react"

import { toast } from "@/lib/notifications/arciin-toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { createFileRequest, type CreatedFileRequest } from "@/lib/api/file-requests"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { FolderSummary } from "@/lib/types/models"
import { copyToClipboard } from "@/lib/utils/clipboard"
import { formatBytes } from "@/lib/utils/format-bytes"

const GB = 1024 * 1024 * 1024

const MEDIA_TYPE_OPTIONS = [
  { value: "IMAGE", label: "Images" },
  { value: "VIDEO", label: "Video" },
  { value: "AUDIO", label: "Audio" },
  { value: "DOCUMENT", label: "Documents" },
] as const

function CreatedRequestCard({
  created,
  folderName,
}: {
  created: CreatedFileRequest
  folderName: string
}) {
  const [copied, setCopied] = useState(false)
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/request/${created.token}`
      : `/request/${created.token}`

  async function handleCopy() {
    const ok = await copyToClipboard(url, "Upload link")
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card/60"
      data-testid="file-request-created"
    >
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Inbox className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">{created.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Uploads land in {folderName}
          </p>
        </div>
      </div>

      <div className="space-y-2 p-2.5">
        <p className="text-[12px] font-medium text-foreground">
          Copy this link now — it won&apos;t be shown again.
        </p>
        <Input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          className="h-9 w-full font-mono text-[11px] selection:bg-primary/20"
          aria-label="File request link"
          data-testid="file-request-url"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2 border-border bg-card"
            onClick={() => void handleCopy()}
            data-testid="file-request-copy"
          >
            {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" size="sm" className="gap-2" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Open
            </a>
          </Button>
        </div>

        <dl className="space-y-1 rounded-lg bg-muted/30 p-2.5 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Expires</dt>
            <dd className="text-foreground">
              {created.expiresAt
                ? new Date(created.expiresAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })
                : "Never"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">File limit</dt>
            <dd className="text-foreground">
              {created.maxFileCount == null ? "No limit" : `${created.maxFileCount} files`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Total size</dt>
            <dd className="text-foreground">
              {created.maxTotalBytes == null ? "No limit" : formatBytes(created.maxTotalBytes)}
            </dd>
          </div>
          {created.hasAccessCode ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Access code</dt>
              <dd className="text-foreground">Required</dd>
            </div>
          ) : null}
        </dl>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Recipients can only upload. They cannot see this folder&apos;s existing files, browse your
          libraries, or see what anyone else uploaded.
        </p>
      </div>
    </div>
  )
}

export function FileRequestDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: FolderSummary | null
}) {
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [expiresInDays, setExpiresInDays] = useState("14")
  const [maxFileCount, setMaxFileCount] = useState("200")
  const [maxTotalGb, setMaxTotalGb] = useState("20")
  const [maxFileGb, setMaxFileGb] = useState("5")
  const [mediaTypes, setMediaTypes] = useState<string[]>([])
  const [requireName, setRequireName] = useState(false)
  const [requireEmail, setRequireEmail] = useState(false)
  const [allowAnonymous, setAllowAnonymous] = useState(true)
  const [allowSubmitterViewOwn, setAllowSubmitterViewOwn] = useState(false)
  const [notifyOwner, setNotifyOwner] = useState(true)
  const [accessCode, setAccessCode] = useState("")
  const [created, setCreated] = useState<CreatedFileRequest | null>(null)

  const createMutation = useMutation({
    mutationFn: createFileRequest,
    onError: (err) => {
      toast.error("Could not create the file request", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
    },
  })

  function reset() {
    setTitle("")
    setMessage("")
    setExpiresInDays("14")
    setMaxFileCount("200")
    setMaxTotalGb("20")
    setMaxFileGb("5")
    setMediaTypes([])
    setRequireName(false)
    setRequireEmail(false)
    setAllowAnonymous(true)
    setAllowSubmitterViewOwn(false)
    setNotifyOwner(true)
    setAccessCode("")
    setCreated(null)
    createMutation.reset()
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) reset()
  }

  function toggleMediaType(value: string) {
    setMediaTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  /** Blank means "no limit"; a number means that limit. */
  function parseLimit(raw: string, multiplier = 1): number | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parsed = Number.parseFloat(trimmed)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.round(parsed * multiplier)
  }

  async function handleCreate() {
    if (!folder) return

    const result = await createMutation.mutateAsync({
      title: title.trim() || `Upload to ${folder.name}`,
      message: message.trim() || undefined,
      destinationFolderId: folder.id,
      expiresInDays: expiresInDays === "never" ? undefined : Number.parseInt(expiresInDays, 10),
      maxFileCount: parseLimit(maxFileCount),
      maxTotalBytes: parseLimit(maxTotalGb, GB),
      maxFileSizeBytes: parseLimit(maxFileGb, GB),
      allowedMediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
      requireName,
      requireEmail,
      allowAnonymous,
      allowSubmitterViewOwn,
      notifyOwner,
      accessCode: accessCode.trim() || undefined,
    })

    setCreated(result)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className={libraryGlassSheetPanel}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Inbox className="size-4 text-primary" />
            Request files
          </SheetTitle>
          <SheetDescription>
            {folder
              ? `Give someone a link that uploads straight into ${folder.name}. They never see what's already there.`
              : "Give someone a link that uploads into a folder."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {created ? (
            <CreatedRequestCard created={created} folderName={folder?.name ?? ""} />
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="fr-title">Request title</FieldLabel>
                <Input
                  id="fr-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={folder ? `Upload to ${folder.name}` : "Send me your files"}
                  data-testid="file-request-title"
                />
                <FieldDescription>Recipients see this at the top of the page.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="fr-message">Instructions (optional)</FieldLabel>
                <textarea
                  id="fr-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Anything the sender should know before uploading."
                  rows={3}
                  data-testid="file-request-message"
                  className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </Field>

              <Field>
                <FieldLabel>Destination</FieldLabel>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[13px]">
                  <Inbox className="size-4 shrink-0 text-primary" />
                  <span className="truncate text-foreground">{folder?.name ?? "—"}</span>
                </div>
                <FieldDescription>
                  Uploads are filed here. Existing files stay hidden from the sender.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="fr-expiry">Expires</FieldLabel>
                <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                  <SelectTrigger id="fr-expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">After 1 day</SelectItem>
                    <SelectItem value="7">After 7 days</SelectItem>
                    <SelectItem value="14">After 14 days</SelectItem>
                    <SelectItem value="30">After 30 days</SelectItem>
                    <SelectItem value="90">After 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-3 gap-2">
                <Field>
                  <FieldLabel htmlFor="fr-count">Max files</FieldLabel>
                  <Input
                    id="fr-count"
                    inputMode="numeric"
                    value={maxFileCount}
                    onChange={(e) => setMaxFileCount(e.target.value)}
                    placeholder="No limit"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fr-total">Total GB</FieldLabel>
                  <Input
                    id="fr-total"
                    inputMode="decimal"
                    value={maxTotalGb}
                    onChange={(e) => setMaxTotalGb(e.target.value)}
                    placeholder="No limit"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fr-per-file">Per file GB</FieldLabel>
                  <Input
                    id="fr-per-file"
                    inputMode="decimal"
                    value={maxFileGb}
                    onChange={(e) => setMaxFileGb(e.target.value)}
                    placeholder="No limit"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel>Allowed file types</FieldLabel>
                <div className="flex flex-wrap gap-3">
                  {MEDIA_TYPE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 text-[13px]"
                    >
                      <Checkbox
                        checked={mediaTypes.includes(option.value)}
                        onCheckedChange={() => toggleMediaType(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <FieldDescription>
                  Leave all unchecked to accept anything. Types are checked against file content,
                  not the filename.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="fr-code">Access code (optional)</FieldLabel>
                <Input
                  id="fr-code"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Leave blank for no code"
                  autoComplete="off"
                  data-testid="file-request-access-code"
                />
                <FieldDescription>
                  Share it separately from the link. Stored hashed — it can&apos;t be recovered.
                </FieldDescription>
              </Field>

              <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
                <label className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox
                    checked={requireName}
                    onCheckedChange={(v) => setRequireName(v === true)}
                  />
                  <span>Require the sender&apos;s name</span>
                </label>
                <label className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox
                    checked={requireEmail}
                    onCheckedChange={(v) => setRequireEmail(v === true)}
                  />
                  <span>Require the sender&apos;s email</span>
                </label>
                <label className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox
                    checked={allowAnonymous}
                    onCheckedChange={(v) => setAllowAnonymous(v === true)}
                  />
                  <span>Allow uploads without an Arciin account</span>
                </label>
                <label className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox
                    checked={allowSubmitterViewOwn}
                    onCheckedChange={(v) => setAllowSubmitterViewOwn(v === true)}
                  />
                  <span>Let the sender see the files they uploaded</span>
                </label>
                <label className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox
                    checked={notifyOwner}
                    onCheckedChange={(v) => setNotifyOwner(v === true)}
                  />
                  <span>Notify me when files arrive</span>
                </label>
              </div>
            </>
          )}
        </div>

        <SheetFooter>
          {created ? (
            <Button type="button" onClick={() => handleOpenChange(false)} className="w-full">
              Done
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!folder || createMutation.isPending}
              className="w-full gap-2"
              data-testid="file-request-create"
            >
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Inbox className="size-4" />
              )}
              Create upload link
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
