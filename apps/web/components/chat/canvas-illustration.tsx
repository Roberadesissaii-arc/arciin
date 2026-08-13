"use client"

import { useEffect, useRef, useState } from "react"
import { ImageOff, Loader2 } from "lucide-react"

/**
 * One generated picture inside a Canvas draft.
 *
 * Drawn on demand rather than during streaming: an image takes far longer than
 * the text around it, and blocking the draft on it would make the whole
 * document feel slow for the sake of a picture the reader has not reached yet.
 *
 * Drawn at most once, ever. The server addresses an illustration by a hash of
 * its description, so reopening a saved draft resolves to the picture already on
 * disk — reopening used to redraw every image, which spent money to produce a
 * slightly different version of what the reader had already seen.
 *
 * A failure degrades to the description as a caption. The marker stays in the
 * draft either way, so what is saved and exported still says where the picture
 * belonged.
 */
export function CanvasIllustration({ description }: { description: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true

    let cancelled = false
    void (async () => {
      try {
        const response = await fetch("/api/chat/illustration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ description }),
        })
        const body = (await response.json().catch(() => null)) as
          | { data?: { id?: string }; error?: { message?: string } }
          | null
        if (cancelled) return
        if (!response.ok || !body?.data?.id) {
          setFailed(body?.error?.message ?? "The picture could not be drawn.")
          return
        }
        // A URL rather than inline bytes: the id is a hash of the description,
        // so the same picture is served from disk and cached by the browser
        // instead of being redrawn every time the draft is reopened.
        setSrc(`/api/chat/illustration/${body.data.id}`)
      } catch {
        if (!cancelled) setFailed("Could not reach the image service.")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [description])

  if (failed) {
    return (
      <figure className="my-3 rounded-lg border border-border bg-muted/20 p-3">
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <ImageOff className="size-3.5 shrink-0" aria-hidden />
          {description}
        </p>
        <figcaption className="mt-1 text-[11px] text-muted-foreground/80">{failed}</figcaption>
      </figure>
    )
  }

  if (!src) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-6 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Drawing “{description}”…
      </div>
    )
  }

  return (
    <figure className="my-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={description}
        className="w-full rounded-lg border border-border"
        loading="lazy"
      />
      <figcaption className="mt-1 text-[11px] text-muted-foreground">{description}</figcaption>
    </figure>
  )
}
