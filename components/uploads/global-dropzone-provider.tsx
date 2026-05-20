"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"

import { UploadQueue } from "@/components/uploads/upload-queue"
import { DuplicateResolutionDialog } from "@/components/uploads/duplicate-resolution-dialog"
import { useGlobalDropzone } from "@/hooks/use-global-dropzone"
import { useUploadOrchestrator } from "@/hooks/use-upload-orchestrator"
import { checkDuplicates, deleteAsset } from "@/lib/api/assets"
import { installUploadBatchSubscriber } from "@/lib/uploads/install-upload-batch-subscriber"
import { nextAvailableFilename, renameFile } from "@/lib/uploads/duplicate-filename"
import { isLikelyDirectoryPlaceholder } from "@/lib/uploads/skip-upload-path"
import { useUploadStore } from "@/lib/stores/upload-store"
import type { DuplicateConflict } from "@/lib/stores/upload-store"

export function GlobalDropzoneProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const uploadFiles = useUploadOrchestrator()
  const uploadContext = useUploadStore((state) => state.uploadContext)
  const pendingConflicts = useUploadStore((state) => state.pendingConflicts)
  const setPendingConflicts = useUploadStore((state) => state.setPendingConflicts)

  const contextRef = useRef(uploadContext)
  useEffect(() => {
    contextRef.current = uploadContext
  }, [uploadContext])

  useEffect(() => {
    installUploadBatchSubscriber()
  }, [])

  const handleFiles = useCallback(
    async (files: File[]) => {
      const uploadable = files.filter((f) => !isLikelyDirectoryPlaceholder(f))
      if (uploadable.length === 0) {
        toast.error(
          "No files to upload. Drop a folder with files inside, or use Upload folder — empty folders cannot be uploaded.",
        )
        return
      }
      const ctx = contextRef.current

      try {
        const result = await checkDuplicates(
          uploadable.map((f) => f.name),
          { libraryId: ctx?.libraryId, folderId: ctx?.folderId ?? null },
        )
        const dupeMap = new Map(result.duplicates.map((d) => [d.filename, d.assetId]))

        const clean: File[] = []
        const conflicts: DuplicateConflict[] = []

        for (const file of uploadable) {
          const existingId = dupeMap.get(file.name)
          if (existingId) {
            conflicts.push({ file, existingAssetId: existingId, resolution: null })
          } else {
            clean.push(file)
          }
        }

        if (clean.length > 0) {
          toast.info(
            clean.length === 1
              ? `Uploading ${clean[0]!.name}…`
              : `Uploading ${clean.length} files…`,
            { duration: 2000 },
          )
          void uploadFiles(clean)
        }

        if (conflicts.length > 0) {
          setPendingConflicts(conflicts)
        }
      } catch {
        void uploadFiles(uploadable)
      }
    },
    [uploadFiles, setPendingConflicts],
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
    const taken = new Set<string>()

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
        continue
      }

      const newName = nextAvailableFilename(conflict.file.name, taken)
      toUpload.push(renameFile(conflict.file, newName))
    }

    if (toUpload.length > 0) {
      toast.info(
        toUpload.length === 1
          ? `Uploading ${toUpload[0]!.name}…`
          : `Uploading ${toUpload.length} files…`,
        { duration: 2000 },
      )
      void uploadFiles(toUpload)
    }
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
