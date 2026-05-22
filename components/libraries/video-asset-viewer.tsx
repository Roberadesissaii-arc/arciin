"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

export function VideoAssetViewer({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className={cn("relative flex h-full items-center justify-center bg-white p-4", className)}>
      {!ready && !error ? (
        <Loader2 className="absolute size-8 animate-spin text-zinc-500" aria-hidden />
      ) : null}
      {error ? (
        <p className="max-w-md px-4 text-center text-sm text-zinc-500">{error}</p>
      ) : (
        <video
          key={src}
          src={src}
          controls
          playsInline
          preload="metadata"
          crossOrigin="use-credentials"
          className={cn(
            "max-h-full max-w-full object-contain shadow-[0_4px_24px_rgba(0,0,0,0.12)]",
            !ready && "opacity-0",
          )}
          onLoadedData={() => setReady(true)}
          onError={() => {
            setError("Could not play this video. Try downloading the file instead.")
            setReady(true)
          }}
        />
      )}
    </div>
  )
}
