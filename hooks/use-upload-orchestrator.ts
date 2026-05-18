"use client"

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { formatUploadFailure } from "@/lib/api/upload-errors"
import { uploadFile } from "@/lib/api/uploads"
import { runWithConcurrency } from "@/lib/uploads/run-with-concurrency"
import { queryKeys } from "@/lib/api/query-keys"
import { useUploadStore } from "@/lib/stores/upload-store"
import { createId } from "@/lib/utils/create-id"
import { resolveUploadTargetForFile } from "@/lib/uploads/resolve-upload-target"
import { inferDestinationLabel } from "@/lib/utils/media-type"

export function useUploadOrchestrator() {
  const queryClient = useQueryClient()
  const addOrUpdate = useUploadStore((state) => state.addOrUpdate)
  const beginUploadBatch = useUploadStore((state) => state.beginUploadBatch)
  const updateProgress = useUploadStore((state) => state.updateProgress)
  const updateStatus = useUploadStore((state) => state.updateStatus)
  const uploadContext = useUploadStore((state) => state.uploadContext)

  return useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const batchId = beginUploadBatch(files.length)
      const concurrency = files.length > 50 ? 2 : files.length > 20 ? 3 : 4

      await runWithConcurrency(files, concurrency, async (file) => {
          const id = createId()
          addOrUpdate({
            id,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            progress: 0,
            status: "QUEUED",
            destination: inferDestinationLabel(file.type, file.name),
            batchId,
          })

          try {
            updateStatus(id, "UPLOADING")
            const target = resolveUploadTargetForFile(file, uploadContext)
            const result = await uploadFile(file, {
              onProgress: (progress) => {
                updateProgress(id, progress)
              },
              targetLibraryId: target.targetLibraryId,
              targetFolderId: target.targetFolderId,
            })

            updateProgress(id, result.progress ?? 100)

            addOrUpdate({
              id,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              progress: result.progress ?? 100,
              status: result.status,
              destination: result.targetLibrary?.name || inferDestinationLabel(file.type, file.name),
              uploadId: result.id,
              batchId,
            })

            if (result.status === "READY") {
              updateStatus(id, "READY")
            } else if (result.status === "PROCESSING") {
              updateStatus(id, "PROCESSING")
            }
          } catch (error) {
            updateStatus(id, "FAILED", formatUploadFailure(error))
          }
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.uploads }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assets() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
      ])
    },
    [addOrUpdate, beginUploadBatch, queryClient, updateProgress, updateStatus, uploadContext]
  )
}
