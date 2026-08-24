"use client"

import { useEffect } from "react"

const RELOAD_KEY = "arciin_chunk_reload"

function isChunkLoadFailure(message: string) {
  return (
    message.includes("ChunkLoadError") ||
    message.includes("Failed to load chunk") ||
    message.includes("Loading chunk") ||
    message.includes("dynamically imported module")
  )
}

/**
 * After a production rebuild, browsers may still reference old hashed chunks (500).
 * Reload once so the page picks up the new build manifest.
 */
export function ChunkLoadRecovery() {
  useEffect(() => {
    const reloadOnce = (reason: string) => {
      if (typeof sessionStorage === "undefined") {
        window.location.reload()
        return
      }
      if (sessionStorage.getItem(RELOAD_KEY) === "1") {
        return
      }
      sessionStorage.setItem(RELOAD_KEY, "1")
      // Say it before navigating away, not after. reload() tears the page down,
      // so the one line explaining an unprompted reload never reached anyone.
      console.info("[Arciin] Reloading after stale build chunks:", reason)
      window.location.reload()
    }

    const onError = (event: ErrorEvent) => {
      const message = event.message || String(event.error ?? "")
      if (isChunkLoadFailure(message)) {
        reloadOnce(message)
      }
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === "string"
            ? event.reason
            : ""
      if (isChunkLoadFailure(message)) {
        reloadOnce(message)
      }
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)

    const clearFlag = window.setTimeout(() => {
      sessionStorage.removeItem(RELOAD_KEY)
    }, 3000)

    return () => {
      window.clearTimeout(clearFlag)
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

  return null
}
