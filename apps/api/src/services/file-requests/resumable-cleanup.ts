import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import type { PrismaClient } from "@prisma/client"

import { removePartial, resumableDir } from "@/services/file-requests/resumable-storage"

/** A partial with no session row is left this long before removal (a create may be mid-flight). */
const ORPHAN_GRACE_MS = 60 * 60 * 1000
const STALE_VERIFY_MS = 30 * 60 * 1000

export type ResumableCleanupReport = {
  expired: number
  cancelledRevoked: number
  partialsRemoved: number
}

/**
 * Remove what abandoned uploads left behind.
 *
 * - UPLOADING sessions past their expiry → EXPIRED, partial deleted.
 * - Sessions on a revoked request → CANCELLED, partial deleted.
 * - Partials whose session finished, failed, was cancelled or expired, or
 *   that have no session at all (after a grace period) → deleted.
 *
 * Never touches a session that is still UPLOADING and in date, or one
 * VERIFYING recently: those are in use. Reserved space is not stored
 * separately — it is computed from open sessions — so closing a session is
 * what releases it.
 */
export async function cleanupResumableUploads(
  prisma: PrismaClient,
  storageRoot: string,
  now = new Date(),
): Promise<ResumableCleanupReport> {
  const report: ResumableCleanupReport = { expired: 0, cancelledRevoked: 0, partialsRemoved: 0 }

  const expired = await prisma.resumableUpload.updateMany({
    where: {
      OR: [
        { status: "UPLOADING", expiresAt: { lte: now } },
        { status: "VERIFYING", expiresAt: { lte: now }, updatedAt: { lt: new Date(now.getTime() - STALE_VERIFY_MS) } },
      ],
    },
    data: { status: "EXPIRED" },
  })
  report.expired = expired.count

  const revoked = await prisma.resumableUpload.updateMany({
    where: {
      status: "UPLOADING",
      fileRequest: { OR: [{ revokedAt: { not: null } }, { status: "REVOKED" }] },
    },
    data: { status: "CANCELLED", errorCode: "REQUEST_REVOKED" },
  })
  report.cancelledRevoked = revoked.count

  let entries: string[] = []
  try {
    entries = await readdir(resumableDir(storageRoot))
  } catch {
    return report // nothing uploaded resumably yet
  }

  const ids = entries.filter((name) => name.endsWith(".partial")).map((name) => name.slice(0, -".partial".length))
  if (ids.length === 0) return report

  const rows = await prisma.resumableUpload.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  })
  const statusById = new Map(rows.map((r) => [r.id, r.status]))

  for (const id of ids) {
    const status = statusById.get(id)
    if (status === "UPLOADING" || status === "VERIFYING") continue
    if (!status) {
      const info = await stat(path.join(resumableDir(storageRoot), `${id}.partial`)).catch(() => null)
      if (!info || now.getTime() - info.mtimeMs < ORPHAN_GRACE_MS) continue
    }
    await removePartial(storageRoot, id)
    report.partialsRemoved += 1
  }

  return report
}

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000

/** Every 30 minutes, plus once shortly after boot. Never blocks a request. */
export function scheduleResumableUploadCleanup(fastify: {
  prisma: PrismaClient
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
}) {
  const run = async () => {
    try {
      const { resolveEffectiveStorageRoot } = await import("@/services/storage/effective-storage-root")
      const instance = await fastify.prisma.instanceConfig.findFirst({ select: { storageRoot: true } })
      const report = await cleanupResumableUploads(fastify.prisma, resolveEffectiveStorageRoot(instance?.storageRoot))
      if (report.expired || report.cancelledRevoked || report.partialsRemoved) {
        fastify.log.info(report, "resumable upload cleanup")
      }
    } catch (err) {
      fastify.log.warn({ err }, "resumable upload cleanup failed")
    }
  }
  setTimeout(run, 60_000).unref()
  setInterval(run, CLEANUP_INTERVAL_MS).unref()
}
