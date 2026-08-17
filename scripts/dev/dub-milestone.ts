/**
 * One acceptance sample of a running dub, as the panel would show it.
 *
 * Reads the persisted row and runs the *real* estimate function over the *real*
 * samples, so the reported figure is what a reader would see rather than a
 * number recomputed by hand for the report.
 */
import { PrismaClient } from "@prisma/client"

import { estimateRemaining, type ProgressSample } from "@arciin/types"

async function main() {
  const prisma = new PrismaClient()
  const dub = await prisma.mediaDub.findUniqueOrThrow({ where: { id: process.argv[2]! } })
  const samples = (Array.isArray(dub.progressSamples) ? dub.progressSamples : []) as ProgressSample[]
  const eta = samples.length ? estimateRemaining(samples, Date.now()) : null

  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString().slice(11, 19),
        status: dub.status,
        stage: dub.stage,
        current: dub.progressCurrent,
        total: dub.progressTotal,
        percent: dub.progressPercent,
        updatedAt: dub.progressUpdatedAt?.toISOString().slice(11, 19) ?? null,
        etaLabel: eta?.label ?? "Estimating time…",
        etaSeconds: eta ? Math.round(eta.secondsRemaining) : null,
        secondsPerChunk: eta ? Number(eta.secondsPerChunk.toFixed(1)) : null,
        error: dub.error,
      },
      null,
      0,
    ),
  )
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
