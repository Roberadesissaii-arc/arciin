/**
 * The AI summary a video card renders, for one asset.
 *
 * Uses the same loader the asset listing calls, so this is the card's actual
 * data source rather than a hand-written approximation of it — which matters
 * while a browser cannot be run beside a live separation.
 */
import { PrismaClient } from "@prisma/client"

import { estimateRemaining, type ProgressSample } from "@arciin/types"

import { loadAssetAiSummaries } from "../../apps/api/src/services/assets/ai-summary"

async function main() {
  const prisma = new PrismaClient()
  const assetId = process.argv[2]!
  const summaries = await loadAssetAiSummaries(prisma, [assetId])
  const summary = summaries.get(assetId)
  const eta = summary?.activity?.samples?.length
    ? estimateRemaining(summary.activity.samples as ProgressSample[], Date.now())
    : null

  console.log(JSON.stringify({ ...summary, tooltipEta: eta?.label ?? null }, null, 2))
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
