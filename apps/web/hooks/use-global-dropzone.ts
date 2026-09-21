"use client"

import { useEffect } from "react"

import { toast } from "sonner"

import { collectDropResult } from "@/lib/uploads/collect-drop-files"
import { useUploadStore } from "@/lib/stores/upload-store"

function hasFileItems(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files")
}

/**
 * Global file drag/drop. Uses dragover + drop + dragend so we do not rely on
 * dragenter/dragleave depth (which breaks across nested DOM / portal layers).
 *
 * Ignores drags that start inside the app (e.g. accidental img/video drags) —
 * only OS / external file drops should show the upload overlay.
 */
export function useGlobalDropzone(onFiles: (files: File[]) => void | Promise<void>) {
  useEffect(() => {
    let dragOriginatedInPage = false

    const onDragStart = () => {
      dragOriginatedInPage = true
    }

    const showIfFiles = (event: DragEvent) => {
      if (!hasFileItems(event)) {
        return
      }

      if (dragOriginatedInPage) {
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

      if (dragOriginatedInPage) {
        dragOriginatedInPage = false
        return
      }

      void (async () => {
        const { upload, skipped } = await collectDropResult(event.dataTransfer)
        // Build artefacts inside a dragged folder are still skipped, but no
        // longer in silence — a drop that quietly shed half its files looked
        // exactly like one that had not.
        if (skipped.length) {
          toast.info(
            skipped.length === 1
              ? `Skipped ${skipped[0]!.name}`
              : `Skipped ${skipped.length} build files`,
            { description: "Build output and dependency folders are not backed up." },
          )
        }
        if (upload.length) {
          await onFiles(upload)
        }
      })()
    }

    const onDragEnd = () => {
      dragOriginatedInPage = false
      hideOverlay()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideOverlay()
      }
    }

    document.addEventListener("dragstart", onDragStart, true)
    window.addEventListener("dragover", showIfFiles, { passive: false })
    window.addEventListener("drop", onDrop, { passive: false })
    window.addEventListener("dragend", onDragEnd)
    window.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("dragstart", onDragStart, true)
      window.removeEventListener("dragover", showIfFiles)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("dragend", onDragEnd)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onFiles])
}
