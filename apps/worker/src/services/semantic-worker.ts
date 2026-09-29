import path from "node:path"
import { setInterval } from "node:timers"

import { Queue, Worker, type ConnectionOptions } from "bullmq"

import { prisma } from "@arciin/database"
import { JOB_QUEUE_NAMES, JOB_TYPES, semanticIndexVersion } from "@arciin/shared"
import { localModelStatus, semanticOllamaBaseUrl } from "@arciin/media-ai"
import { normalizeConfiguredStorageRoot } from "@arciin/storage"

import { workerConfig } from "@/config"
import { findAssetsNeedingSemanticIndex, indexAssetSemantics } from "@/services/semantic-index"

/**
 * The worker half of local semantic search.
 *
 * A sweep every minute finds assets whose index is missing or stale and
 * queues them; the queue is processed one asset at a time. Nothing happens
 * until the owner has enabled semantic search *and* started indexing, so a
 * deploy never sets Ollama to work on a whole library by itself. While
 * Ollama is down the sweep adds nothing — no tight retry loop — and indexing
 * resumes when it is back.
 */

const SWEEP_EVERY_MS = 60_000
const SWEEP_BATCH = 20
/** Never queue more than this ahead: the backlog is recomputed from the database anyway. */
const MAX_QUEUED = 40

export function startSemanticIndexing(input: { connection: ConnectionOptions; prefix: string }) {
  const baseUrl = semanticOllamaBaseUrl()
  const queue = new Queue(JOB_QUEUE_NAMES.semantic, {
    connection: input.connection,
    prefix: input.prefix,
    defaultJobOptions: {
      attempts: 3,
      // Ollama restarting or busy: back off a minute, then two, then four.
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: true,
      // The row records the failure (a code) and when to retry; a kept failed
      // job would also hold its id and stop the sweep from queueing it again.
      removeOnFail: true,
    },
  })

  const storageRoot = async () => {
    const instance = await prisma.instanceConfig.findFirst()
    return normalizeConfiguredStorageRoot(instance?.storageRoot, path.resolve(workerConfig.ARCIIN_DATA_DIR))
  }

  const worker = new Worker(
    JOB_QUEUE_NAMES.semantic,
    async (job) => {
      const assetId = String(job.data.assetId ?? "")
      if (!assetId) return "gone"
      return indexAssetSemantics(assetId, { prisma, storageRoot: await storageRoot(), baseUrl })
    },
    // One at a time: captioning on a CPU-only host is heavy, and this shares
    // the machine with everything else Arciin does.
    { connection: input.connection, prefix: input.prefix, concurrency: 1 },
  )
  worker.on("failed", (job, error) => {
    // A code, never content.
    console.warn(`[semantic] asset ${String(job?.data?.assetId ?? "?")} not indexed: ${(error as { code?: string }).code ?? error.name}`)
  })

  let sweeping = false
  const sweep = async () => {
    if (sweeping) return
    sweeping = true
    try {
      const config = await prisma.semanticSearchConfig.findUnique({ where: { id: "default" } })
      if (!config?.enabled || !config.indexingActive) return
      const status = await localModelStatus({ baseUrl, model: config.embeddingModel })
      if (status.ollama !== "online" || !status.installed) return
      const counts = await queue.getJobCounts("waiting", "active", "delayed")
      const queued = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0)
      if (queued >= MAX_QUEUED) return
      const ids = await findAssetsNeedingSemanticIndex(prisma, {
        model: config.embeddingModel,
        digest: status.model.digest,
        indexVersion: semanticIndexVersion(config.rebuildEpoch),
        limit: Math.min(SWEEP_BATCH, MAX_QUEUED - queued),
      })
      for (const assetId of ids) {
        // One job per asset at a time: the id deduplicates while it is queued.
        await queue.add(JOB_TYPES.semanticIndex, { assetId }, { jobId: `semantic-${assetId}` })
      }
    } catch (error) {
      console.warn(`[semantic] sweep skipped: ${(error as Error).name}`)
    } finally {
      sweeping = false
    }
  }
  const timer = setInterval(() => void sweep(), SWEEP_EVERY_MS)
  void sweep()

  return {
    sweep,
    close: async () => {
      clearInterval(timer)
      await worker.close()
      await queue.close()
    },
  }
}
