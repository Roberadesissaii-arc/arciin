"use client"

import { useEffect, useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { submitPublicShareFeedback, type ShareFeedbackSentiment } from "@/lib/api/shares"
import { cn } from "@/lib/utils"

function feedbackStorageKey(token: string, assetId: string) {
  return `arciin-share-feedback:${token}:${assetId}`
}

function readStoredVote(storageKey: string): ShareFeedbackSentiment | null {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === "LIKE" || stored === "DISLIKE") return stored
  } catch {
    /* ignore storage errors */
  }
  return null
}

export function ShareFeedbackButtons({
  token,
  assetId,
  variant = "default",
  className,
}: {
  token: string
  assetId: string
  variant?: "default" | "hero"
  className?: string
}) {
  const storageKey = feedbackStorageKey(token, assetId)
  const [vote, setVote] = useState<ShareFeedbackSentiment | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    // Hydration boundary: localStorage is browser-only, so the stored vote can
    // only be read after mount — a one-shot sync here is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVote(readStoredVote(storageKey))
  }, [storageKey])

  const submit = async (sentiment: ShareFeedbackSentiment) => {
    if (pending) return

    const next: ShareFeedbackSentiment | null = vote === sentiment ? null : sentiment

    setPending(true)
    try {
      if (next) {
        await submitPublicShareFeedback(token, { sentiment: next, assetId })
        try {
          localStorage.setItem(storageKey, next)
        } catch {
          /* ignore storage errors */
        }
      } else {
        try {
          localStorage.removeItem(storageKey)
        } catch {
          /* ignore storage errors */
        }
      }
      setVote(next)
    } catch {
      /* silent on share page — owner is notified in the app */
    } finally {
      setPending(false)
    }
  }

  const isHero = variant === "hero"
  const labelClass = isHero ? "text-[11px] text-white/80" : "text-[11px] text-muted-foreground"
  const likeActive = vote === "LIKE"
  const dislikeActive = vote === "DISLIKE"

  const buttonClass = cn(
    "size-8 disabled:opacity-50",
    isHero
      ? "border-white/25 bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
      : "border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
  )

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className={cn("mr-0.5 shrink-0", labelClass)}>This file</span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={buttonClass}
        aria-label={likeActive ? "Remove like" : "Like this file"}
        aria-pressed={likeActive}
        disabled={pending}
        onClick={() => void submit("LIKE")}
      >
        <ThumbsUp
          className={cn(
            "size-3.5 transition-colors",
            likeActive
              ? isHero
                ? "fill-current text-[#ff4f12]"
                : "fill-current text-primary"
              : "text-current",
          )}
        />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={buttonClass}
        aria-label={dislikeActive ? "Remove dislike" : "Dislike this file"}
        aria-pressed={dislikeActive}
        disabled={pending}
        onClick={() => void submit("DISLIKE")}
      >
        <ThumbsDown
          className={cn(
            "size-3.5 transition-colors",
            dislikeActive
              ? isHero
                ? "fill-current text-zinc-300"
                : "fill-current text-destructive"
              : "text-current",
          )}
        />
      </Button>
    </div>
  )
}
