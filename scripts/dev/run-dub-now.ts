/**
 * Run one dub synchronously, with the real separator and the real voice model.
 *
 * For acceptance runs where a queue would only add indirection: the handler is
 * the same code the worker executes, so this exercises separation, synthesis,
 * fitting, mixing and storage exactly as production does.
 */
import { PrismaClient } from "@prisma/client"

async function main() {
  const [assetId, language] = process.argv.slice(2)
  const prisma = new PrismaClient()

  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })
  const transcript = await prisma.mediaTranscript.findUniqueOrThrow({ where: { assetId } })
  const translation = await prisma.mediaTranslation.findFirstOrThrow({
    where: { transcriptId: transcript.id, language },
  })

  const speakers = [
    ...new Set(translation.segments.map((s) => s.speaker).filter(Boolean)),
  ]
  const profiles = (speakers.length ? speakers : ["Speaker 1"]).map((speakerId) => ({
    speakerId,
    presentation: "auto",
    ageStyle: "auto",
    pitch: speakerId.endsWith("2") ? "high" : "low",
    energy: "medium",
    pace: "medium",
    selectedGeminiVoice: speakerId.endsWith("2") ? "Puck" : "Kore",
    accent: { kind: "preserve-source" },
    emotion: { kind: "match-original" },
  }))

  const jobRecord = await prisma.job.create({
    data: { type: "dub_media", status: "QUEUED", progress: 0, payload: { assetId, language } },
  })
  const dub = await prisma.mediaDub.upsert({
    where: { assetId_language: { assetId, language } },
    create: {
      assetId, language, transcriptId: transcript.id, translationId: translation.id,
      status: "PENDING", stage: "Queued", provider: "gemini", voiceProfiles: profiles,
      jobId: jobRecord.id,
    },
    update: {
      status: "PENDING", stage: "Queued", error: null, errorDetail: null,
      progressPercent: null, progressCurrent: null, progressTotal: null,
      voiceProfiles: profiles, jobId: jobRecord.id, audioStorageObjectId: null,
    },
  })

  console.log("speakers:", JSON.stringify(profiles.map((p) => [p.speakerId, p.selectedGeminiVoice])))
  const started = Date.now()
  const { handleMediaJob } = await import("../../apps/worker/src/processors/worker-handlers.ts")
  await handleMediaJob("dub_media", {
    assetId, dubId: dub.id, translationId: translation.id,
    userId: asset.ownerId, jobRecordId: jobRecord.id,
  }, null)

  const final = await prisma.mediaDub.findUniqueOrThrow({
    where: { id: dub.id },
  })
  const audio = final.audioStorageObjectId
    ? await prisma.storageObject.findUnique({ where: { id: final.audioStorageObjectId } })
    : null
  console.log(JSON.stringify({
    status: final.status,
    error: final.error,
    seconds: Math.round((Date.now() - started) / 1000),
    backgroundStrategy: final.backgroundStrategy,
    durationMs: final.durationMs,
    audioPath: audio?.physicalPath ?? null,
    audioBytes: audio ? Number(audio.sizeBytes) : null,
    voices: final.voiceProfiles,
  }, null, 2))
  await prisma.$disconnect()

}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
