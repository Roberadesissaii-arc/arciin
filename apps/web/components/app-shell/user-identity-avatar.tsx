"use client"

import { useMemo, useState } from "react"

import {
  clearCachedUserAvatar,
  readCachedUserAvatar,
  writeCachedUserAvatar,
} from "@/lib/utils/user-avatar-cache"
import { cn } from "@/lib/utils"

type UserIdentityAvatarProps = {
  name: string
  imageUrl?: string | null
  /** Used to restore the last known avatar on refresh before the image finishes loading. */
  userId?: string
  size?: "sm" | "md"
  /** Sidebar sits on a dark surface — avoids a bright white loading disc. */
  tone?: "light" | "dark"
  shape?: "circle" | "rounded"
  className?: string
}

function markLoadedFromImage(img: HTMLImageElement | null): boolean {
  return Boolean(img && img.complete && img.naturalWidth > 0)
}

/** Profile photo or initials — neutral surface; orange only on the letter fallback. */
export function UserIdentityAvatar({
  name,
  imageUrl,
  userId,
  size = "md",
  tone = "light",
  shape = "rounded",
  className,
}: UserIdentityAvatarProps) {
  const letter = (name.trim()[0] ?? "?").toUpperCase()
  const storedCache = useMemo(
    () => (userId ? readCachedUserAvatar(userId) : null),
    [userId],
  )
  const [runtimeCache, setRuntimeCache] = useState<string | null>(null)
  const resolvedUrl = imageUrl?.trim() || runtimeCache || storedCache
  const isDark = tone === "dark"

  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const hasPhoto = Boolean(resolvedUrl) && !failed
  const showImage = hasPhoto && loaded
  const pendingImage = hasPhoto && !loaded
  const imageKey = resolvedUrl ?? "no-photo"

  function persistCache() {
    const url = imageUrl?.trim()
    if (!userId || !url) return
    writeCachedUserAvatar(userId, url)
    setRuntimeCache(url)
  }

  function handleLoad() {
    setLoaded(true)
    persistCache()
  }

  function handleError() {
    setFailed(true)
    setLoaded(false)
    if (userId && resolvedUrl === (runtimeCache ?? storedCache)) {
      clearCachedUserAvatar(userId)
      setRuntimeCache(null)
    }
  }

  function bindImageRef(el: HTMLImageElement | null) {
    if (markLoadedFromImage(el)) {
      setLoaded(true)
      persistCache()
    }
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-semibold shadow-sm",
        shape === "circle" ? "rounded-full" : "rounded-xl",
        size === "sm" ? "size-8 text-[13px]" : "size-10 text-[15px]",
        hasPhoto
          ? isDark
            ? "bg-zinc-800 ring-1 ring-zinc-700/80"
            : "bg-zinc-200/80 ring-1 ring-zinc-300/70"
          : isDark
            ? "bg-zinc-800 ring-1 ring-zinc-700/80"
            : "bg-gradient-to-b from-zinc-50 to-zinc-100 ring-1 ring-zinc-200/80",
        className,
      )}
      aria-hidden={!name}
    >
      {resolvedUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- self-hosted instance avatar URL
        <img
          key={imageKey}
          ref={bindImageRef}
          src={resolvedUrl}
          alt=""
          className={cn(
            "size-full object-cover",
            showImage ? "opacity-100" : "opacity-0",
          )}
          suppressHydrationWarning
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : null}
      {pendingImage ? (
        <span
          className={cn(
            "absolute inset-0 animate-pulse",
            isDark ? "bg-zinc-700/50" : "bg-zinc-300/40",
          )}
          aria-hidden
        />
      ) : null}
      {!showImage && !pendingImage ? (
        <span className="text-[#FF4F12]">{letter}</span>
      ) : null}
    </div>
  )
}
