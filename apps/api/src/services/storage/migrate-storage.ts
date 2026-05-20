import { mkdir } from "node:fs/promises"

import type { PrismaClient } from "@prisma/client"
import { estimateStorageCopyBytes, ensureStorageLayout } from "@arciin/database"
import { JOB_TYPES } from "@arciin/shared"

import {
  resolveDisplayStorageRoot,
  resolveEffectiveStorageRoot,
} from "@/services/storage/effective-storage-root"
import { probeStorageRoot, resolveStorageUsageBytes } from "@/services/storage/local-storage"
import { runStorageMigration } from "@arciin/database"

export class StorageMigrationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = "StorageMigrationError"
  }
}

export { runStorageMigration }

export async function validateStorageMigrationTarget(
  prisma: PrismaClient,
  targetPath: string,
): Promise<{ fromRoot: string; toRoot: string; bytesToCopy: number }> {
  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) {
    throw new StorageMigrationError("Instance is not initialized.", "INSTANCE_NOT_READY")
  }

  const fromRoot = resolveEffectiveStorageRoot(instance.storageRoot)
  const toRoot = resolveEffectiveStorageRoot(targetPath.trim())

  if (fromRoot === toRoot) {
    throw new StorageMigrationError("Choose a different folder than the current storage root.", "SAME_PATH")
  }

  const active = await prisma.job.findFirst({
    where: {
      type: JOB_TYPES.migrateStorage,
      status: { in: ["QUEUED", "ACTIVE"] },
    },
  })
  if (active) {
    throw new StorageMigrationError("A storage migration is already in progress.", "MIGRATION_IN_PROGRESS")
  }

  await mkdir(toRoot, { recursive: true })
  await ensureStorageLayout(toRoot)

  const targetProbe = await probeStorageRoot(toRoot)
  if (!targetProbe.writable) {
    throw new StorageMigrationError(
      "The destination is not writable. Fix permissions or pick another folder.",
      "NOT_WRITABLE",
    )
  }

  const bytesToCopy = await estimateStorageCopyBytes(fromRoot)
  const agg = await prisma.storageObject.aggregate({ _sum: { sizeBytes: true } })
  const trackedBytes = Number(agg._sum.sizeBytes ?? 0)
  const usageBytes = await resolveStorageUsageBytes(fromRoot, trackedBytes)

  const required = Math.max(bytesToCopy, usageBytes)
  if (
    targetProbe.availableBytes != null &&
    targetProbe.availableBytes > 0 &&
    targetProbe.availableBytes < required * 1.05
  ) {
    throw new StorageMigrationError(
      "Not enough free space on the destination volume for a safe copy.",
      "INSUFFICIENT_SPACE",
    )
  }

  return { fromRoot, toRoot, bytesToCopy: required }
}

export function storageMigrationDisplayRoot(toRoot: string) {
  return resolveDisplayStorageRoot(toRoot)
}
