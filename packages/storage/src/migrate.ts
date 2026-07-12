import { access, cp, mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"

import type { PrismaClient } from "@prisma/client"

const COPY_SUBDIRS = ["objects", "libraries", "thumbnails", "avatars", "logs"] as const
const LAYOUT_SUBDIRS = ["objects", "libraries", "thumbnails", "temp", "logs", "avatars"] as const

async function directoryExists(dir: string): Promise<boolean> {
  try {
    await access(dir)
    return true
  } catch {
    return false
  }
}

export async function ensureStorageLayout(rootPath: string) {
  await Promise.all(
    LAYOUT_SUBDIRS.map((sub) => mkdir(path.join(rootPath, sub), { recursive: true })),
  )
}

export async function estimateStorageCopyBytes(root: string): Promise<number> {
  let total = 0

  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          const s = await stat(full)
          total += Number(s.size)
        } catch {
          /* skip */
        }
      }
    }
  }

  for (const sub of COPY_SUBDIRS) {
    const subPath = path.join(root, sub)
    if (await directoryExists(subPath)) {
      await walk(subPath)
    }
  }

  return total
}

export async function runStorageMigration(
  prisma: PrismaClient,
  input: {
    fromRoot: string
    toRoot: string
    jobRecordId: string
    userId?: string
    displayRootLabel: string
  },
  onProgress: (progress: number, phase: string) => Promise<void>,
): Promise<{ foldersCopied: number; fromRoot: string; toRoot: string }> {
  const { fromRoot, toRoot, jobRecordId, displayRootLabel } = input
  let foldersCopied = 0
  const steps = COPY_SUBDIRS.length + 2
  let step = 0

  await onProgress(Math.round((step / steps) * 100), "preparing")
  await ensureStorageLayout(toRoot)

  for (const sub of COPY_SUBDIRS) {
    step += 1
    const src = path.join(fromRoot, sub)
    const dest = path.join(toRoot, sub)
    if (!(await directoryExists(src))) {
      await onProgress(Math.round((step / steps) * 100), `skipped_${sub}`)
      continue
    }
    await onProgress(Math.round((step / steps) * 100), `copying_${sub}`)
    await cp(src, dest, { recursive: true, force: false, errorOnExist: false })
    foldersCopied += 1
  }

  step += 1
  await onProgress(Math.round((step / steps) * 100), "updating_database")

  await prisma.$transaction(async (tx) => {
    const objects = await tx.storageObject.findMany({
      select: { id: true, objectKey: true },
    })
    for (const obj of objects) {
      await tx.storageObject.update({
        where: { id: obj.id },
        data: { physicalPath: path.join(toRoot, obj.objectKey) },
      })
    }

    const instance = await tx.instanceConfig.findFirstOrThrow({ select: { id: true } })
    await tx.instanceConfig.update({
      where: { id: instance.id },
      data: { storageRoot: toRoot },
    })

    await tx.storageLocation.updateMany({
      where: { isDefault: true },
      data: { rootPath: toRoot },
    })
  })

  step += 1
  await onProgress(100, "completed")

  if (input.userId) {
    await prisma.activityEvent.create({
      data: {
        userId: input.userId,
        type: "storage.migrated",
        title: "Storage migrated",
        message: `Files copied to ${displayRootLabel}. Your previous folder was not deleted.`,
        metadata: {
          jobId: jobRecordId,
          fromRoot,
          toRoot,
          displayRoot: displayRootLabel,
          foldersCopied,
        },
      },
    })
  }

  return { foldersCopied, fromRoot, toRoot }
}
