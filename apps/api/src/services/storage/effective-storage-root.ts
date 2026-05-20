import path from "node:path"

import type { PrismaClient } from "@prisma/client"
import { normalizeConfiguredStorageRoot } from "@arciin/shared"

import { apiConfig } from "@/config"

function hostDataDir(): string | null {
  const raw = process.env.ARCIIN_HOST_DATA_DIR?.trim()
  return raw ? path.resolve(raw) : null
}

export function resolveEffectiveStorageRoot(configured: string | null | undefined): string {
  return normalizeConfiguredStorageRoot(configured, apiConfig.dataDir, hostDataDir())
}

/** Path shown in UI: host bind mount when Docker, else effective runtime path. */
export function resolveDisplayStorageRoot(configured: string | null | undefined): string {
  const effective = resolveEffectiveStorageRoot(configured)
  const host = hostDataDir()
  if (host && effective === path.resolve(apiConfig.dataDir)) {
    return host
  }
  return effective
}

export async function loadEffectiveStorageRoot(prisma: PrismaClient): Promise<string> {
  const instance = await prisma.instanceConfig.findFirst()
  const defaultStorage = await prisma.storageLocation.findFirst({
    where: { isDefault: true },
  })

  return resolveEffectiveStorageRoot(instance?.storageRoot ?? defaultStorage?.rootPath)
}

export type StorageRootRepairResult = {
  repaired: boolean
  previousRoot?: string
  storageRoot?: string
}

/** Fix DB paths that point at /app/data/arciin instead of the Docker bind mount. */
export async function repairInstanceStorageRootsIfNeeded(
  prisma: PrismaClient,
): Promise<StorageRootRepairResult> {
  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) return { repaired: false }

  const effective = resolveEffectiveStorageRoot(instance.storageRoot)
  const previous = path.resolve(instance.storageRoot)
  if (effective === previous) return { repaired: false }

  await prisma.$transaction(async (tx) => {
    await tx.instanceConfig.update({
      where: { id: instance.id },
      data: { storageRoot: effective },
    })
    await tx.storageLocation.updateMany({
      where: { isDefault: true },
      data: { rootPath: effective },
    })
  })

  return { repaired: true, previousRoot: instance.storageRoot, storageRoot: effective }
}
