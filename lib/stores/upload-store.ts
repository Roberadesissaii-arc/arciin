"use client"

import { create } from "zustand"

import type { UploadStatus } from "@/lib/types/models"
import { inferDestinationLabel } from "@/lib/utils/media-type"

export type UploadQueueItem = {
  id: string
  fileName: string
  mimeType?: string
  sizeBytes: number
  progress: number
  status: UploadStatus
  destination: string
  error?: string
  uploadId?: string
}

type UploadStoreState = {
  queue: UploadQueueItem[]
  overlayVisible: boolean
  addFiles: (files: File[]) => void
  addOrUpdate: (item: UploadQueueItem) => void
  updateProgress: (id: string, progress: number) => void
  updateStatus: (id: string, status: UploadStatus, error?: string) => void
  removeUpload: (id: string) => void
  clearCompleted: () => void
  setOverlayVisible: (visible: boolean) => void
}

export const useUploadStore = create<UploadStoreState>((set) => ({
  queue: [],
  overlayVisible: false,
  addFiles: (files) =>
    set((state) => ({
      queue: [
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          progress: 0,
          status: "QUEUED" as UploadStatus,
          destination: inferDestinationLabel(file.type, file.name),
        })),
        ...state.queue,
      ],
    })),
  addOrUpdate: (item) =>
    set((state) => {
      const existing = state.queue.findIndex((queueItem) => queueItem.id === item.id)

      if (existing === -1) {
        return {
          queue: [item, ...state.queue],
        }
      }

      const nextQueue = [...state.queue]
      nextQueue[existing] = {
        ...nextQueue[existing],
        ...item,
      }

      return {
        queue: nextQueue,
      }
    }),
  updateProgress: (id, progress) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === id || item.uploadId === id
          ? {
              ...item,
              progress,
            }
          : item
      ),
    })),
  updateStatus: (id, status, error) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === id || item.uploadId === id
          ? {
              ...item,
              status,
              error,
              ...(status === "READY" ? { progress: 100 } : {}),
            }
          : item
      ),
    })),
  removeUpload: (id) =>
    set((state) => ({
      queue: state.queue.filter((item) => item.id !== id),
    })),
  clearCompleted: () =>
    set((state) => ({
      queue: state.queue.filter(
        (item) => !["READY", "FAILED"].includes(item.status)
      ),
    })),
  setOverlayVisible: (overlayVisible) =>
    set(() => ({
      overlayVisible,
    })),
}))
