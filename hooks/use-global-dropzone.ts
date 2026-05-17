"use client"

import { useEffect } from "react"

import { useUploadStore } from "@/lib/stores/upload-store"

function hasFileItems(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files")
}

/**
 * Global file drag/drop. Uses dragover + drop + dragend so we do not rely on
 * dragenter/dragleave depth (which breaks across nested DOM / portal layers).
 */
export function useGlobalDropzone(onFiles: (files: File[]) => void) {
  useEffect(() => {
    const showIfFiles = (event: DragEvent) => {
      if (!hasFileItems(event)) {
        return
      }

      event.preventDefault()

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy"
      }

      const { overlayVisible, setOverlayVisible } = useUploadStore.getState()

      if (!overlayVisible) {
        setOverlayVisible(true)
      }
    }

    const hideOverlay = () => {
      useUploadStore.getState().setOverlayVisible(false)
    }

    const onDrop = (event: DragEvent) => {
      if (!hasFileItems(event)) {
        return
      }

      event.preventDefault()
      hideOverlay()

      const files = Array.from(event.dataTransfer?.files || [])

      if (files.length) {
        onFiles(files)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideOverlay()
      }
    }

    window.addEventListener("dragover", showIfFiles, { passive: false })
    window.addEventListener("drop", onDrop, { passive: false })
    window.addEventListener("dragend", hideOverlay)
    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("dragover", showIfFiles)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("dragend", hideOverlay)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onFiles])
}
