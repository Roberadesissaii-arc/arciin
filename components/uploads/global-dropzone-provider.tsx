"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"

import { UploadQueue } from "@/components/uploads/upload-queue"
import { DuplicateResolutionDialog } from "@/components/uploads/duplicate-resolution-dialog"
import { useGlobalDropzone } from "@/hooks/use-global-dropzone"
import { useUploadOrchestrator } from "@/hooks/use-upload-orchestrator"
import { checkDuplicates, deleteAsset } from "@/lib/api/assets"
import { useUploadStore } from "@/lib/stores/upload-store"
import type { DuplicateConflict } from "@/lib/stores/upload-store"

function addSuffix(filename: string): string {
  const dot = filename.lastIndexOf(".")
  if (dot === -1) return `${filename} (1)`
  return `${filename.slice(0, dot)} (1)${filename.slice(dot)}`
}

export function GlobalDropzoneProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const uploadFiles = useUploadOrchestrator()
  const uploadContext = useUploadStore((state) => state.uploadContext)
  const pendingConflicts = useUploadStore((state) => state.pendingConflicts)
  const setPendingConflicts = useUploadStore((state) => state.setPendingConflicts)

  // Keep a stable ref to the upload context so handleFiles doesn't go stale
  const contextRef = useRef(uploadContext)
  useEffect(() => { contextRef.current = uploadContext }, [uploadContext])

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const ctx = contextRef.current

      toast.info(
        files.length === 1
          ? `Uploading ${files[0].name}…`
          : `Uploading ${files.length} files…`,
        { duration: 2000 }
      )

      try {
        const result = await checkDuplicates(
          files.map((f) => f.name),
          { libraryId: ctx?.libraryId, folderId: ctx?.folderId ?? null }
        )
        const dupeMap = new Map(result.duplicates.map((d) => [d.filename, d.assetId]))

        const clean: File[] = []
        const conflicts: DuplicateConflict[] = []

        for (const file of files) {
          const existingId = dupeMap.get(file.name)
          if (existingId) {
            conflicts.push({ file, existingAssetId: existingId, resolution: null })
          } else {
            clean.push(file)
          }
        }

        // Upload files that have no conflict immediately
        if (clean.length > 0) void uploadFiles(clean)

        // Show resolution dialog for conflicts
        if (conflicts.length > 0) setPendingConflicts(conflicts)
      } catch {
        // If the duplicate check fails, just upload everything normally
        void uploadFiles(files)
      }
    },
    [uploadFiles, setPendingConflicts]
  )

  useGlobalDropzone(handleFiles)

  useEffect(() => {
    const onSelected = (event: Event) => {
      const customEvent = event as CustomEvent<File[]>
      if (customEvent.detail?.length) void handleFiles(customEvent.detail)
    }

    window.addEventListener("arciin:files-selected", onSelected as EventListener)
    return () => window.removeEventListener("arciin:files-selected", onSelected as EventListener)
  }, [handleFiles])

  async function handleResolve(resolved: DuplicateConflict[]) {
    setPendingConflicts(null)

    const toUpload: File[] = []

    for (const conflict of resolved) {
      if (conflict.resolution === "skip") continue

      if (conflict.resolution === "replace") {
        try {
          await deleteAsset(conflict.existingAssetId)
        } catch {
          toast.error(`Could not remove existing ${conflict.file.name}.`)
          continue
        }
        toUpload.push(conflict.file)
      } else {
        // "keep-both" — rename with (1) suffix
        const renamed = new File([conflict.file], addSuffix(conflict.file.name), {
          type: conflict.file.type,
        })
        toUpload.push(renamed)
      }
    }

    if (toUpload.length > 0) void uploadFiles(toUpload)
  }

  return (
    <>
      {children}
      <UploadQueue />
      {pendingConflicts && pendingConflicts.length > 0 && (
        <DuplicateResolutionDialog
          conflicts={pendingConflicts}
          onResolve={handleResolve}
          onCancel={() => setPendingConflicts(null)}
        />
      )}
    </>
  )
}
