"use client"

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { uploadFile } from "@/lib/api/uploads"
import { queryKeys } from "@/lib/api/query-keys"
import { useUploadStore } from "@/lib/stores/upload-store"
import { inferDestinationLabel } from "@/lib/utils/media-type"

export function useUploadOrchestrator() {
  const queryClient = useQueryClient()
  const addOrUpdate = useUploadStore((state) => state.addOrUpdate)
  const updateProgress = useUploadStore((state) => state.updateProgress)
  const updateStatus = useUploadStore((state) => state.updateStatus)

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
            })

            addOrUpdate({
              id,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              progress: result.progress,
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
          } catch (error) {
            updateStatus(
              id,
              "FAILED",
              error instanceof Error ? error.message : "Upload failed."
            )
            toast.error(`${file.name} could not be uploaded.`)
          }
        })
      )
    },
    [addOrUpdate, queryClient, updateProgress, updateStatus]
  )
}
