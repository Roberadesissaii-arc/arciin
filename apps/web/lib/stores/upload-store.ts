"use client"

import { create } from "zustand"

import type { LibraryKind, UploadStatus } from "@/lib/types/models"
import { createId } from "@/lib/utils/create-id"
import { inferDestinationLabel } from "@/lib/utils/media-type"

export type DuplicateConflict = {
  file: File
  existingAssetId: string
  resolution: "replace" | "keep-both" | "skip" | null
}

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
  batchId?: string
}

export type UploadBatchFailure = {
  fileName: string
  error: string
}

export type UploadBatchState = {
  id: string
  total: number
  finished: number
  succeeded: number
  failed: number
  failures: UploadBatchFailure[]
  announced: boolean
  countedKeys: string[]
}

export type UploadContext = {
  libraryId?: string
  folderId?: string
  libraryKind?: LibraryKind
}

type UploadStoreState = {
  queue: UploadQueueItem[]
  uploadBatch: UploadBatchState | null
  overlayVisible: boolean
  uploadContext: UploadContext | null
  pendingConflicts: DuplicateConflict[] | null
  addFiles: (files: File[]) => void
  beginUploadBatch: (total: number) => string
  addOrUpdate: (item: Partial<UploadQueueItem> & Pick<UploadQueueItem, "id">) => void
  updateProgress: (id: string, progress: number) => void
  updateStatus: (id: string, status: UploadStatus, error?: string) => void
  removeUpload: (id: string) => void
  clearCompleted: () => void
  setOverlayVisible: (visible: boolean) => void
  setUploadContext: (ctx: UploadContext | null) => void
  setPendingConflicts: (conflicts: DuplicateConflict[] | null) => void
  clearUploadBatch: () => void
}

/** Statuses that finish the client upload batch (PROCESSING = saved, worker still analyzing). */
const TERMINAL: UploadStatus[] = ["READY", "PROCESSING", "FAILED"]

const STATUS_RANK: Record<UploadStatus, number> = {
  QUEUED: 0,
  UPLOADING: 1,
  UPLOADED: 2,
  ANALYZING: 3,
  CLASSIFIED: 4,
  PROCESSING: 5,
  READY: 6,
  FAILED: 7,
}

function mergeQueueStatus(previous: UploadStatus, incoming?: UploadStatus): UploadStatus {
  if (!incoming) return previous
  if (incoming === "FAILED" || previous === "FAILED") return "FAILED"
  return STATUS_RANK[incoming] >= STATUS_RANK[previous] ? incoming : previous
}

function itemKeys(item: UploadQueueItem): string[] {
  return [item.id, item.uploadId].filter((k): k is string => Boolean(k))
}

function recordBatchTerminal(
  state: UploadStoreState,
  item: UploadQueueItem,
  status: UploadStatus,
  error?: string,
): UploadBatchState | null {
  const batch = state.uploadBatch
  if (!batch || !item.batchId || item.batchId !== batch.id) return batch

  const keys = itemKeys(item)
  if (keys.some((k) => batch.countedKeys.includes(k))) return batch

  const succeeded = status === "READY" || status === "PROCESSING"
  const failed = status === "FAILED"
  if (!succeeded && !failed) return batch

  return {
    ...batch,
    finished: batch.finished + 1,
    succeeded: batch.succeeded + (succeeded ? 1 : 0),
    failed: batch.failed + (failed ? 1 : 0),
    failures:
      failed
        ? [
            ...batch.failures,
            { fileName: item.fileName, error: error?.trim() || "Upload failed." },
          ]
        : batch.failures,
    countedKeys: [...batch.countedKeys, ...keys],
  }
}

export const useUploadStore = create<UploadStoreState>((set) => ({
  queue: [],
  uploadBatch: null,
  overlayVisible: false,
  uploadContext: null,
  pendingConflicts: null,
  beginUploadBatch: (total) => {
    const id = createId()
    set({
      uploadBatch: {
        id,
        total,
        finished: 0,
        succeeded: 0,
        failed: 0,
        failures: [],
        announced: false,
        countedKeys: [],
      },
    })
    return id
  },
  clearUploadBatch: () => set({ uploadBatch: null }),
  addFiles: (files) =>
    set((state) => ({
      queue: [
        ...files.map((file) => ({
          id: createId(),
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
      let existing = state.queue.findIndex(
        (queueItem) =>
          queueItem.id === item.id ||
          (item.uploadId != null &&
            queueItem.uploadId != null &&
            queueItem.uploadId === item.uploadId),
      )

      /**
       * The API publishes `upload.started` before it sends the HTTP response,
       * so the server event can arrive while this file's queue item still only
       * has its client-generated id. Matching on id or uploadId alone misses
       * it and adds a second row for one file — which then double-counts in the
       * batch tally and leaves an orphan stuck on "Uploading".
       *
       * Adopt the in-flight local entry for the same file instead. Only items
       * that have not yet been linked to a server id are eligible, so each
       * server event claims at most one.
       */
      let adopted = false
      if (existing === -1 && item.uploadId != null) {
        existing = state.queue.findIndex(
          (queueItem) =>
            queueItem.uploadId == null &&
            queueItem.fileName === item.fileName &&
            queueItem.sizeBytes === item.sizeBytes &&
            (queueItem.status === "QUEUED" || queueItem.status === "UPLOADING"),
        )
        adopted = existing !== -1
      }

      if (existing === -1) {
        const nextItem: UploadQueueItem = {
          fileName: item.fileName ?? "Upload",
          sizeBytes: item.sizeBytes ?? 0,
          progress: item.progress ?? 0,
          status: item.status ?? "UPLOADING",
          destination: item.destination ?? "Inbox",
          ...item,
        }
        return {
          queue: [nextItem, ...state.queue],
        }
      }

      const previous = state.queue[existing]
      const mergedProgress = Math.max(previous.progress ?? 0, item.progress ?? 0)
      const mergedDestination =
        item.destination &&
        item.destination !== "Inbox" &&
        item.destination.trim().length > 0
          ? item.destination
          : previous.destination

      const nextQueue = [...state.queue]
      nextQueue[existing] = {
        ...previous,
        ...item,
        // On adoption keep the client id: the orchestrator still refers to this
        // item by it when the HTTP response lands. The server id is attached as
        // uploadId, and lookups match on either.
        ...(adopted ? { id: previous.id } : {}),
        progress: mergedProgress,
        destination: mergedDestination,
        status: mergeQueueStatus(previous.status, item.status),
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
              progress: Math.max(item.progress ?? 0, progress),
            }
          : item
      ),
    })),
  updateStatus: (id, status, error) =>
    set((state) => {
      let touched: UploadQueueItem | undefined
      const queue = state.queue.map((item) => {
        if (item.id !== id && item.uploadId !== id) return item
        touched = item
        return {
          ...item,
          status,
          error,
          ...(status === "READY" ? { progress: 100 } : {}),
        }
      })

      let uploadBatch = state.uploadBatch
      if (touched && TERMINAL.includes(status)) {
        uploadBatch = recordBatchTerminal(state, touched, status, error)
      }

      return { queue, uploadBatch }
    }),
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
  setUploadContext: (uploadContext) =>
    set(() => ({
      uploadContext,
    })),
  setPendingConflicts: (pendingConflicts) =>
    set(() => ({
      pendingConflicts,
    })),
}))
