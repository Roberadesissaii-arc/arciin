"use client"

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { uploadFile } from "@/lib/api/uploads"
import {
  notifyUploadCompleted,
  notifyUploadFailed,
} from "@/lib/notifications/notify-upload-realtime"
import { queryKeys } from "@/lib/api/query-keys"
import { useUploadStore } from "@/lib/stores/upload-store"
import { inferDestinationLabel } from "@/lib/utils/media-type"

export function useUploadOrchestrator() {
  const queryClient = useQueryClient()
  const addOrUpdate = useUploadStore((state) => state.addOrUpdate)
  const updateProgress = useUploadStore((state) => state.updateProgress)
  const updateStatus = useUploadStore((state) => state.updateStatus)
  const uploadContext = useUploadStore((state) => state.uploadContext)

  return useCallback(
    async (files: File[]) => {
      await Promise.all(
        files.map(async (file) => {
          const id = crypto.randomUUID()
          addOrUpdate({
            id,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            progress: 0,
            status: "QUEUED",
            destination: inferDestinationLabel(file.type, file.name),
          })

          try {
            updateStatus(id, "UPLOADING")
            const result = await uploadFile(file, {
              onProgress: (progress) => {
                updateProgress(id, progress)
              },
              // Only pin to a library when inside a folder — otherwise let the
              // server classify by file type and route to the correct library.
              targetLibraryId: uploadContext?.folderId ? uploadContext.libraryId : undefined,
              targetFolderId:  uploadContext?.folderId,
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
            })

            await Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.uploads }),
              queryClient.invalidateQueries({ queryKey: queryKeys.assets() }),
              queryClient.invalidateQueries({ queryKey: queryKeys.activity() }),
              queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
            ])

            if (result.status === "READY" || result.status === "PROCESSING") {
              notifyUploadCompleted({
                dedupeKey: result.id || result.assetId || id,
                title: `${file.name} uploaded`,
              })
            }
          } catch (error) {
            updateStatus(
              id,
              "FAILED",
              error instanceof Error ? error.message : "Upload failed."
            )
            const errMsg = error instanceof Error ? error.message : "Upload failed."
            notifyUploadFailed({
              dedupeKey: id,
              title: `${file.name} could not be uploaded`,
              message: errMsg,
            })
          }
        })
      )
    },
    [addOrUpdate, queryClient, updateProgress, updateStatus, uploadContext]
  )
}
