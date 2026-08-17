// Re-queues an existing dub the same way the API route does.
import { PrismaClient } from "@prisma/client"
import { Queue } from "bullmq"
import IORedis from "ioredis"

const [dubId] = process.argv.slice(2)
const prisma = new PrismaClient()
const dub = await prisma.mediaDub.findUniqueOrThrow({
  where: { id: dubId },
  include: { asset: { select: { id: true, ownerId: true, originalFilename: true, durationSeconds: true } } },
})

const jobRecord = await prisma.job.create({
  data: { type: "dub_media", status: "QUEUED", progress: 0,
    payload: { assetId: dub.assetId, language: dub.language, filename: dub.asset.originalFilename } },
})
await prisma.mediaDub.update({
  where: { id: dub.id },
  data: { status: "PENDING", stage: "Queued", error: null, errorDetail: null,
    progressPercent: null, progressCurrent: null, progressTotal: null, progressUpdatedAt: new Date(),
    jobId: jobRecord.id },
})

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
const queue = new Queue("media", { connection, prefix: process.env.ARCIIN_QUEUE_PREFIX || "bull" })
await queue.add("dub_media", {
  assetId: dub.assetId, dubId: dub.id, translationId: dub.translationId,
  userId: dub.asset.ownerId, jobRecordId: jobRecord.id,
})
console.log(`queued ${dub.language} dub for ${dub.asset.originalFilename} (${dub.asset.durationSeconds}s)`)
await queue.close(); await connection.quit(); await prisma.$disconnect()
