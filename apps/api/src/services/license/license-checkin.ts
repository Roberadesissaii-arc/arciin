import type { FastifyInstance } from "fastify"

import { licenseServerBaseUrl } from "@/services/license/hosted-client"
import { loadLicenseSnapshot, refreshLicense } from "@/services/license/license-service"

/**
 * Background license check-in.
 *
 * Refresh used to happen only when an admin opened Settings, so a revoked or
 * cancelled license could stay live indefinitely on an instance nobody was
 * looking at. This closes that window without turning licensing into something
 * the product depends on to run.
 *
 * Deliberate properties:
 *
 *   - It never blocks startup. The first check is delayed, and the timer is
 *     unref'd so it cannot hold the process open on shutdown.
 *   - An unreachable authority is a non-event. `refreshLicense` already falls
 *     back to evaluating the stored token locally, so an outage costs nothing
 *     until the grace window closes — there is no retry storm and no failure
 *     path that can lock a customer out of their own files.
 *   - Free instances do no work at all: with no hosted token there is nothing
 *     to check in about, and a self-hoster who never bought anything should
 *     never see traffic to our servers.
 */

/**
 * Six hours. Chosen against the licensing model rather than picked round: grace
 * is measured in days, so this is frequent enough that a revocation is noticed
 * the same day and rare enough that a fleet of instances is nowhere near the
 * authority's per-IP budget.
 */
const CHECK_IN_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** Long enough to stay clear of boot, short enough to catch a revocation on restart. */
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1_000

let scheduled = false

async function checkInOnce(fastify: FastifyInstance): Promise<void> {
  if (!licenseServerBaseUrl()) return

  const snapshot = await loadLicenseSnapshot(fastify.prisma)
  // Nothing hosted to refresh — free core, or a local dev key.
  if (snapshot.source !== "hosted" || !snapshot.signedToken) return

  const before = { plan: snapshot.plan, status: snapshot.status }
  const after = await refreshLicense(fastify.prisma)

  if (after.plan !== before.plan || after.status !== before.status) {
    fastify.log.info(
      { from: before, to: { plan: after.plan, status: after.status } },
      "[license] entitlement changed at scheduled check-in",
    )
  }
}

export function scheduleLicenseCheckIn(fastify: FastifyInstance): void {
  if (scheduled) return
  scheduled = true

  const run = () => {
    void checkInOnce(fastify).catch((error) => {
      // Licensing must never take the API down with it.
      fastify.log.warn({ err: error }, "[license] scheduled check-in failed")
    })
  }

  const first = setTimeout(() => {
    run()
    const interval = setInterval(run, CHECK_IN_INTERVAL_MS)
    interval.unref?.()
  }, FIRST_CHECK_DELAY_MS)
  first.unref?.()
}

/** Test seam — the module-level guard makes scheduling idempotent per process. */
export function resetLicenseCheckInSchedule(): void {
  scheduled = false
}

export const __licenseCheckInInternals = { checkInOnce, CHECK_IN_INTERVAL_MS }
