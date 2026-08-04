import { beforeEach, describe, expect, it } from "vitest"

import { useUploadStore } from "../apps/web/lib/stores/upload-store"

/**
 * UP-S01 — the upload queue must survive either arrival order.
 *
 * The orchestrator registers a queue item under a client-generated id, while
 * the API publishes `upload.started` *before* it sends the HTTP response. Which
 * of the two lands first is a genuine race, and both orders must converge on
 * one queue entry and one batch tally.
 */

function resetStore() {
  useUploadStore.setState({
    queue: [],
    uploadBatch: null,
    overlayVisible: false,
    uploadContext: null,
    pendingConflicts: null,
  })
}

/** What the orchestrator does when it starts sending a file. */
function orchestratorRegisters(localId: string, batchId: string) {
  useUploadStore.getState().addOrUpdate({
    id: localId,
    fileName: "holiday.mp4",
    sizeBytes: 1024,
    progress: 0,
    status: "UPLOADING",
    destination: "Videos",
    batchId,
  })
}

/** What the socket handler does on `upload.started`. */
function socketAnnouncesStart(serverUploadId: string) {
  useUploadStore.getState().addOrUpdate({
    id: serverUploadId,
    uploadId: serverUploadId,
    fileName: "holiday.mp4",
    sizeBytes: 1024,
    progress: 88,
    status: "UPLOADING",
    destination: "Videos",
  })
}

/** What the orchestrator does once the HTTP response arrives. */
function orchestratorReceivesResponse(
  localId: string,
  serverUploadId: string,
  batchId: string,
) {
  useUploadStore.getState().addOrUpdate({
    id: localId,
    uploadId: serverUploadId,
    fileName: "holiday.mp4",
    sizeBytes: 1024,
    progress: 88,
    status: "PROCESSING",
    destination: "Videos",
    batchId,
  })
}

describe("upload queue arrival ordering", () => {
  beforeEach(resetStore)

  it("keeps one entry when the HTTP response arrives before the socket event", () => {
    const batchId = useUploadStore.getState().beginUploadBatch(1)

    orchestratorRegisters("local-1", batchId)
    orchestratorReceivesResponse("local-1", "server-1", batchId)
    socketAnnouncesStart("server-1")

    const queue = useUploadStore.getState().queue
    expect(queue).toHaveLength(1)
    expect(queue[0].uploadId).toBe("server-1")
  })

  it("keeps one entry when the socket event beats the HTTP response", () => {
    const batchId = useUploadStore.getState().beginUploadBatch(1)

    orchestratorRegisters("local-1", batchId)
    // The API publishes upload.started before replying, so this can land first.
    socketAnnouncesStart("server-1")
    orchestratorReceivesResponse("local-1", "server-1", batchId)

    const queue = useUploadStore.getState().queue
    expect(queue).toHaveLength(1)
    expect(queue[0].uploadId).toBe("server-1")
  })

  it("counts a single file once in the batch tally, whichever order wins", () => {
    for (const socketFirst of [true, false]) {
      resetStore()
      const batchId = useUploadStore.getState().beginUploadBatch(1)

      orchestratorRegisters("local-1", batchId)
      if (socketFirst) {
        socketAnnouncesStart("server-1")
        orchestratorReceivesResponse("local-1", "server-1", batchId)
      } else {
        orchestratorReceivesResponse("local-1", "server-1", batchId)
        socketAnnouncesStart("server-1")
      }

      // Client marks it PROCESSING; the worker's completion marks it READY.
      useUploadStore.getState().updateStatus("local-1", "PROCESSING")
      useUploadStore.getState().updateStatus("server-1", "READY")

      const batch = useUploadStore.getState().uploadBatch
      expect(batch?.total).toBe(1)
      expect(batch?.finished, socketFirst ? "socket first" : "response first").toBe(1)
      expect(batch?.succeeded).toBe(1)
    }
  })

  it("moves a processing item to READY on the worker's completion event", () => {
    const batchId = useUploadStore.getState().beginUploadBatch(1)

    orchestratorRegisters("local-1", batchId)
    orchestratorReceivesResponse("local-1", "server-1", batchId)
    expect(useUploadStore.getState().queue[0].status).toBe("PROCESSING")

    // The single final upload.completed the worker emits at progress 100.
    useUploadStore.getState().updateProgress("server-1", 100)
    useUploadStore.getState().updateStatus("server-1", "READY")

    const item = useUploadStore.getState().queue[0]
    expect(item.status).toBe("READY")
    expect(item.progress).toBe(100)
  })

  it("shows a failed upload as FAILED rather than leaving it processing", () => {
    const batchId = useUploadStore.getState().beginUploadBatch(1)

    orchestratorRegisters("local-1", batchId)
    orchestratorReceivesResponse("local-1", "server-1", batchId)
    useUploadStore.getState().updateStatus("server-1", "FAILED", "ffmpeg exited 1")

    const item = useUploadStore.getState().queue[0]
    expect(item.status).toBe("FAILED")
    expect(item.error).toBe("ffmpeg exited 1")
    expect(useUploadStore.getState().uploadBatch?.failed).toBe(1)
  })

  it("never regresses a READY item back to PROCESSING on a late event", () => {
    const batchId = useUploadStore.getState().beginUploadBatch(1)

    orchestratorRegisters("local-1", batchId)
    orchestratorReceivesResponse("local-1", "server-1", batchId)
    useUploadStore.getState().updateStatus("server-1", "READY")

    // A stale upload.started replay must not undo completion.
    socketAnnouncesStart("server-1")

    expect(useUploadStore.getState().queue[0].status).toBe("READY")
  })
})
