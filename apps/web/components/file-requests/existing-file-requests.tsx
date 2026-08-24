"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarPlus, Link2Off, Loader2 } from "lucide-react"

import {
  extendFileRequest,
  listFileRequests,
  revokeFileRequest,
  type FileRequestSummary,
} from "@/lib/api/file-requests"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/utils/format-bytes"

/**
 * The upload links already handed out, and a way to take them back.
 *
 * A file request is a public URL that writes into a private folder: anyone
 * holding it can upload without an account. The server has had list, revoke and
 * extend routes the whole time, and this file's three API wrappers targeted
 * them correctly — but nothing in the app called any of them. So a link could
 * be created and then never seen again, never revoked, and if it was made
 * without an expiry it accepted uploads forever.
 *
 * Same shape as the share-link gap, and closed the same way. Only the token
 * prefix is shown; the full token is the credential and is revealed once, at
 * creation.
 */

const EXTEND_DAYS = 7

function statusLabel(request: FileRequestSummary): { text: string; tone: string } {
  switch (request.status) {
    case "REVOKED":
      return { text: "Revoked", tone: "text-muted-foreground" }
    case "EXPIRED":
      return { text: "Expired", tone: "text-amber-600" }
    case "LIMIT_REACHED":
      return { text: "Limit reached", tone: "text-amber-600" }
    default:
      break
  }
  if (!request.expiresAt) return { text: "No expiry", tone: "text-amber-600" }
  const at = new Date(request.expiresAt)
  return {
    text: `Expires ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    tone: "text-muted-foreground",
  }
}

function receivedLabel(request: FileRequestSummary): string {
  if (request.fileCount === 0) return "Nothing received yet"
  const files = `${request.fileCount} file${request.fileCount === 1 ? "" : "s"}`
  return request.totalBytes > 0 ? `${files} · ${formatBytes(request.totalBytes)}` : files
}

export function ExistingFileRequests({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<string | null>(null)

  const requestsQuery = useQuery({
    queryKey: ["file-requests"],
    queryFn: ({ signal }) => listFileRequests(signal),
    staleTime: 10_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["file-requests"] })
  }

  const revoke = useMutation({
    mutationFn: revokeFileRequest,
    onSuccess: () => {
      setConfirming(null)
      invalidate()
    },
  })

  const extend = useMutation({
    mutationFn: (id: string) => extendFileRequest(id, EXTEND_DAYS),
    onSuccess: invalidate,
  })

  if (requestsQuery.isLoading) {
    return (
      <div className={cn("flex items-center gap-2 text-[12px] text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin" />
        Loading your upload links…
      </div>
    )
  }

  if (requestsQuery.isError) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        Could not load your existing upload links.{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => void requestsQuery.refetch()}
        >
          Retry
        </button>
      </p>
    )
  }

  const requests = requestsQuery.data ?? []
  // A revoked link cannot accept anything; keeping it here only adds noise.
  const active = requests.filter((request) => request.status !== "REVOKED")

  if (active.length === 0) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        No active upload links.
      </p>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Active upload links ({active.length})
      </p>
      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {active.map((request) => {
          const status = statusLabel(request)
          const isConfirming = confirming === request.id
          const revoking = revoke.isPending && revoke.variables === request.id
          const extending = extend.isPending && extend.variables === request.id

          return (
            <li
              key={request.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
              data-testid="file-request-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{request.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">{request.tokenPrefix}…</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">
                    {request.destination?.folderName ?? "Folder removed"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{receivedLabel(request)}</span>
                  <span aria-hidden>·</span>
                  <span className={status.tone}>{status.text}</span>
                </p>
              </div>

              {isConfirming ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 px-2.5 text-[11px]"
                    disabled={revoking}
                    onClick={() => revoke.mutate(request.id)}
                    data-testid="file-request-revoke-confirm"
                  >
                    {revoking ? "Revoking…" : "Revoke"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={revoking}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    disabled={extending}
                    onClick={() => extend.mutate(request.id)}
                    title={`Give this link another ${EXTEND_DAYS} days`}
                  >
                    {extending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CalendarPlus className="size-3.5" />
                    )}
                    +{EXTEND_DAYS}d
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirming(request.id)}
                    title="Revoke this link — anyone holding it loses access immediately"
                    data-testid="file-request-revoke"
                  >
                    <Link2Off className="size-3.5" />
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {revoke.isError ? (
        <p className="text-[11px] text-destructive">
          Could not revoke that link. Please try again.
        </p>
      ) : null}
      {extend.isError ? (
        <p className="text-[11px] text-destructive">
          Could not extend that link. Please try again.
        </p>
      ) : null}
    </div>
  )
}
