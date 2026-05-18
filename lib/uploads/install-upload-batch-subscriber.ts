import { announceUploadBatchComplete } from "@/lib/uploads/upload-batch-notify"
import { useUploadStore } from "@/lib/stores/upload-store"

let installed = false

/** Play one completion sound per batch (not per file). */
export function installUploadBatchSubscriber() {
  if (installed || typeof window === "undefined") return
  installed = true

  useUploadStore.subscribe((state, prev) => {
    const batch = state.uploadBatch
    if (!batch || batch.announced || batch.finished < batch.total) return
    if (prev.uploadBatch?.id === batch.id && prev.uploadBatch.announced) return

    useUploadStore.setState({
      uploadBatch: { ...batch, announced: true },
    })
    announceUploadBatchComplete(batch)
  })
}
