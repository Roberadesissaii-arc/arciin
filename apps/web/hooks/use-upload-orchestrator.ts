"use client"

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { formatUploadFailure } from "@/lib/api/upload-errors"
import { notifyUploadFolderPrepare } from "@/lib/notifications/toast-actions"
import { getLibraries } from "@/lib/api/libraries"
import type { LibrarySummary } from "@/lib/types/models"
import type { PreparedUploadTarget } from "@/lib/uploads/ensure-upload-folder-tree"
import { uploadFile } from "@/lib/api/uploads"
import { queryKeys } from "@/lib/api/query-keys"
import {
  countFolderUploadRoots,
  prepareUploadTargets,
} from "@/lib/uploads/ensure-upload-folder-tree"
import { runWithConcurrency } from "@/lib/uploads/run-with-concurrency"
import { resolveUploadTargetForFile } from "@/lib/uploads/resolve-upload-target"
import { useUploadStore } from "@/lib/stores/upload-store"
import { createId } from "@/lib/utils/create-id"
import { inferDestinationLabel } from "@/lib/utils/media-type"

function uploadConcurrency(fileCount: number): number {
  if (fileCount > 120) return 1
  if (fileCount > 50) return 2
  if (fileCount > 20) return 3
  return 4
}

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
      const concurrency = uploadConcurrency(files.length)

      let libraries: LibrarySummary[] = []
      try {
        libraries = await getLibraries()
      } catch {
        libraries = []
      }

      const folderRoots = countFolderUploadRoots(files)
      if (folderRoots > 0) {
        notifyUploadFolderPrepare(files.length)
      }

      let prepared: PreparedUploadTarget[]
      try {
        prepared = await prepareUploadTargets(files, {
          libraries,
          contextLibraryId: uploadContext?.libraryId,
          contextFolderId: uploadContext?.folderId,
        })
      } catch {
        prepared = files.map((file) => ({ file }))
      }

      await runWithConcurrency(prepared, concurrency, async ({ file, targetLibraryId, targetFolderId }) => {
        const id = createId()
        const contextTarget = resolveUploadTargetForFile(file, uploadContext)
        const libraryId = targetLibraryId ?? contextTarget.targetLibraryId
        const folderId = targetFolderId ?? contextTarget.targetFolderId

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
          const result = await uploadFile(file, {
            onProgress: (progress) => {
              updateProgress(id, progress)
            },
            targetLibraryId: libraryId,
            targetFolderId: folderId,
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

          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.uploads }),
            queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot }),
            queryClient.invalidateQueries({ queryKey: queryKeys.activityRoot }),
            queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
            queryClient.invalidateQueries({ queryKey: ["folders"] }),
          ])
        } catch (error) {
          updateStatus(id, "FAILED", formatUploadFailure(error))
        }
      })
    },
    [addOrUpdate, beginUploadBatch, queryClient, updateProgress, updateStatus, uploadContext],
  )
}
