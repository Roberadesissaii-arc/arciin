"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link2Off, Loader2 } from "lucide-react"

import { listShareLinks, revokeShareLink } from "@/lib/api/shares"
import type { ShareLinkSummary } from "@/lib/types/models"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The links already handed out, and a way to take them back.
 *
 * The share dialog told people "You can revoke links anytime from Activity".
 * There was nothing in Activity, nothing anywhere else, and no caller for
 * `revokeShareLink` in the whole app — so a public link to a private file,
 * created without an expiry, was permanent. The server route worked the entire
 * time; only this was missing.
 *
 * Only the token *prefix* is shown. The full token is the credential, revealed
 * once at creation; reprinting it here would turn a management screen into a
 * second place it can leak from.
 */

function expiryLabel(share: ShareLinkSummary): { text: string; expired: boolean } {
  if (!share.expiresAt) return { text: "No expiry", expired: false }
  const at = new Date(share.expiresAt)
  const expired = at.getTime() <= Date.now()
  return {
    text: expired
      ? "Expired"
      : `Expires ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    expired,
  }
}

function shareScope(share: ShareLinkSummary): string {
  if (share.resourceType === "FOLDER") return "Folder"
  if (share.assetCount && share.assetCount > 1) return `${share.assetCount} files`
  return "1 file"
}

export function ExistingShareLinks({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<string | null>(null)

  const sharesQuery = useQuery({
    queryKey: ["share-links"],
    queryFn: ({ signal }) => listShareLinks(signal),
    staleTime: 10_000,
  })

  const revoke = useMutation({
    mutationFn: revokeShareLink,
    onSuccess: () => {
      setConfirming(null)
      void queryClient.invalidateQueries({ queryKey: ["share-links"] })
    },
  })

  if (sharesQuery.isLoading) {
    return (
      <div className={cn("flex items-center gap-2 text-[12px] text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin" />
        Loading your links…
      </div>
    )
  }

  if (sharesQuery.isError) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        Could not load your existing links.{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => void sharesQuery.refetch()}
        >
          Retry
        </button>
      </p>
    )
  }

  const shares = sharesQuery.data ?? []
  if (shares.length === 0) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        No active share links.
      </p>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Active links ({shares.length})
      </p>
      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {shares.map((share) => {
          const expiry = expiryLabel(share)
          const isConfirming = confirming === share.id
          const busy = revoke.isPending && revoke.variables === share.id

          return (
            <li
              key={share.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{share.label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">{share.tokenPrefix}…</span>
                  <span aria-hidden>·</span>
                  <span>{shareScope(share)}</span>
                  <span aria-hidden>·</span>
                  <span className={expiry.expired ? "text-amber-600" : undefined}>
                    {expiry.text}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {share.viewCount} view{share.viewCount === 1 ? "" : "s"}
                  </span>
                </p>
              </div>

              {isConfirming ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 px-2.5 text-[11px]"
                    disabled={busy}
                    onClick={() => revoke.mutate(share.id)}
                  >
                    {busy ? "Revoking…" : "Revoke"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirming(share.id)}
                  title="Revoke this link — anyone holding it loses access immediately"
                >
                  <Link2Off className="size-3.5" />
                  Revoke
                </Button>
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
    </div>
  )
}
