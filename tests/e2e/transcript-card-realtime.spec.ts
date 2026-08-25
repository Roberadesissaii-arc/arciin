import { PrismaClient } from "@prisma/client"
import { expect, test } from "@playwright/test"
import Redis from "ioredis"

/**
 * A finished transcript clears the card, without a reload.
 *
 * The card's spinner is drawn from the asset listing, and the listing only
 * refreshes when a realtime event invalidates it. `asset.transcript.ready` was
 * being published by the worker into a room where nothing was listening — the
 * browser's copy of the event list had fallen behind the shared one — so the
 * spinner sat on a transcript that had already finished until the page was
 * reloaded by hand.
 *
 * This drives the same sequence the worker drives: move the row, announce it,
 * and expect the card to notice on its own.
 */

const FIXTURE = "e2e-video-transcript-fixture"
const CHANNEL = "dev:arciin:events"

const prisma = new PrismaClient()
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379/14")

/** Exactly what apps/worker/src/services/realtime.ts puts on the wire. */
async function announce(type: string, userId: string, assetId: string) {
  await redis.publish(
    CHANNEL,
    JSON.stringify({
      id: `e2e-${Date.now()}`,
      type,
      userId,
      assetId,
      message: "e2e",
      createdAt: new Date().toISOString(),
    }),
  )
}

let ownerId = ""
let restore: { status: string } | null = null

test.beforeAll(async () => {
  const asset = await prisma.asset.findUnique({
    where: { id: FIXTURE },
    select: { ownerId: true },
  })
  if (!asset) throw new Error(`fixture ${FIXTURE} missing — run the e2e seed`)
  ownerId = asset.ownerId

  const existing = await prisma.mediaTranscript.findUnique({
    where: { assetId: FIXTURE },
    select: { status: true },
  })
  restore = existing ? { status: existing.status } : null
})

test.afterAll(async () => {
  if (restore) {
    await prisma.mediaTranscript.update({
      where: { assetId: FIXTURE },
      data: { status: restore.status as never },
    })
  }
  await prisma.$disconnect()
  redis.disconnect()
})

test.describe("the card follows the transcript in real time", () => {
  test.setTimeout(120_000)

  test("the spinner clears when the transcript finishes — no reload", async ({ page }) => {
    await prisma.mediaTranscript.update({
      where: { assetId: FIXTURE },
      data: { status: "PROCESSING" },
    })

    await page.goto("/videos")
    const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
    await expect(card).toBeVisible({ timeout: 60_000 })

    const indicator = card.getByTestId("asset-ai-indicator")
    await expect(indicator).toBeVisible({ timeout: 30_000 })
    await expect(indicator).toHaveAttribute("data-ai-status", "running")

    // The work finishes, exactly as the worker would record and announce it.
    await prisma.mediaTranscript.update({
      where: { assetId: FIXTURE },
      data: { status: "READY" },
    })
    await announce("asset.transcript.ready", ownerId, FIXTURE)

    // The regression: this only cleared after a manual refresh.
    await expect(indicator).toHaveCount(0, { timeout: 20_000 })

    // And it really is gone, not merely repainted — the page was never reloaded.
    expect(page.url()).toContain("/videos")
  })

  test("a failed transcript also stops the spinner", async ({ page }) => {
    await prisma.mediaTranscript.update({
      where: { assetId: FIXTURE },
      data: { status: "PROCESSING" },
    })

    await page.goto("/videos")
    const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
    await expect(card).toBeVisible({ timeout: 60_000 })
    const indicator = card.getByTestId("asset-ai-indicator")
    await expect(indicator).toHaveAttribute("data-ai-status", "running", { timeout: 30_000 })

    await prisma.mediaTranscript.update({
      where: { assetId: FIXTURE },
      data: { status: "FAILED", error: "e2e induced failure" },
    })
    await announce("asset.transcript.failed", ownerId, FIXTURE)

    // Still an indicator, but it stops claiming work is in flight.
    await expect(indicator).toHaveAttribute("data-ai-status", "failed", { timeout: 20_000 })
  })
})
