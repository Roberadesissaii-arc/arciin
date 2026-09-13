import path from "node:path"

import { JOB_TYPES } from "@arciin/config"
import { assetSupportsDocumentThumbnail, backupPathBasename, requiresWorkerProcessing } from "@arciin/shared"
import type { PrismaClient, SyncEntry, SyncRoot } from "@prisma/client"
import type { MultipartFile } from "@fastify/multipart"
import type { FastifyBaseLogger } from "fastify"

import { analyzeStoredFile } from "@/services/classification/media-classification"
import { commitUpload } from "@/services/uploads/commit-upload"
import { dispatchPendingForUpload } from "@/services/uploads/outbox-dispatch"
import { mediaQueue } from "@/services/jobs/queues"
import { loadUserPreferences } from "@/services/user/preferences"
import { resolveEffectiveStorageRoot } from "@/services/storage/effective-storage-root"
import {
  createObjectStoragePath,
  moveTempToObject,
  removeTempFile,
  writeMultipartToTemp,
} from "@/services/storage/local-storage"
import { UploadTooLargeError } from "@/services/config/upload-limits"

import { BackupError } from "./errors"
import { ensureFolderChain, safeRelativePath } from "./sync"
import { refreshBackupCounters } from "./profile"

export async function ingestBackupFile(
  prisma: PrismaClient,
  input: {
    root: SyncRoot
    userId: string
    clientEntryId: string
    relativePath: string
    file: MultipartFile
    log: FastifyBaseLogger
    modifiedAtClient?: Date | null
    contentHash?: string | null
  },
): Promise<SyncEntry> {
  const relativePath = safeRelativePath(input.relativePath)
  if (!relativePath) {
    throw new BackupError("PATH_INVALID", "A file must have a relative path.", 400)
  }

  const name = backupPathBasename(relativePath)
  const { folderId } = await ensureFolderChain(prisma, input.root, relativePath)
  const existing = await prisma.syncEntry.findUnique({
    where: {
      syncRootId_clientEntryId: {
        syncRootId: input.root.id,
        clientEntryId: input.clientEntryId,
      },
    },
  })

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
  const library = await prisma.library.findUnique({
    where: { id: (await prisma.folder.findUniqueOrThrow({ where: { id: input.root.folderId } })).libraryId },
  })
  if (!library) {
    throw new BackupError("BACKUP_NOT_SUPPORTED", "Computers library is missing.", 503)
  }

  let tempPath: string | null = null
  try {
    const tempResult = await writeMultipartToTemp(input.file, storageRoot)
    tempPath = tempResult.tempPath
    const analysis = await analyzeStoredFile(
      tempResult.tempPath,
      name || input.file.filename,
      input.file.mimetype,
      input.log,
    )

    if (existing?.assetId && existing.contentHash === tempResult.checksumSha256) {
      await removeTempFile(tempResult.tempPath)
      tempPath = null
      const unchanged = await prisma.syncEntry.update({
        where: { id: existing.id },
        data: {
          relativePath,
          sizeBytes: BigInt(tempResult.sizeBytes),
          contentHash: tempResult.checksumSha256,
          modifiedAtClient: input.modifiedAtClient ?? existing.modifiedAtClient,
          syncState: "ACTIVE",
          deletedAt: null,
        },
      })
      await prisma.asset.update({
        where: { id: existing.assetId },
        data: { folderId, originalFilename: name, deletedAt: null, status: "READY" },
      })
      return unchanged
    }

    const existingStorageObject = await prisma.storageObject.findFirst({
      where: {
        checksumSha256: tempResult.checksumSha256,
        storageLocationId: library.storageLocationId,
      },
      select: { id: true, objectKey: true, physicalPath: true },
    })

    let objectKey = existingStorageObject?.objectKey ?? ""
    let physicalPath = existingStorageObject?.physicalPath ?? ""
    if (!existingStorageObject) {
      const objectPath = createObjectStoragePath(
        tempResult.checksumSha256,
        analysis.extension || path.extname(name),
        storageRoot,
      )
      await moveTempToObject(tempResult.tempPath, objectPath.physicalPath)
      tempPath = null
      objectKey = objectPath.objectKey
      physicalPath = objectPath.physicalPath
    } else {
      await removeTempFile(tempResult.tempPath)
      tempPath = null
    }

    if (existing?.assetId) {
      const storageObject =
        existingStorageObject ??
        (await prisma.storageObject.findFirst({
          where: { checksumSha256: tempResult.checksumSha256, storageLocationId: library.storageLocationId },
        }))
      if (!storageObject && !existingStorageObject) {
        // Row is created by commitUpload for new objects; for updates create it here.
      }
      const storageObjectId =
        existingStorageObject?.id ??
        (
          await prisma.storageObject.create({
            data: {
              storageLocationId: library.storageLocationId,
              objectKey,
              physicalPath,
              sizeBytes: BigInt(tempResult.sizeBytes),
              checksumSha256: tempResult.checksumSha256,
              mimeType: analysis.mimeType,
            },
          })
        ).id

      await prisma.asset.update({
        where: { id: existing.assetId },
        data: {
          folderId,
          storageObjectId,
          originalFilename: name,
          filename: `${tempResult.checksumSha256}.${analysis.extension || "bin"}`,
          mimeType: analysis.mimeType,
          mediaType: analysis.mediaType as never,
          extension: analysis.extension || "bin",
          sizeBytes: BigInt(tempResult.sizeBytes),
          checksumSha256: tempResult.checksumSha256,
          deletedAt: null,
          status: "READY",
          uploadClient: "backup",
        },
      })

      const updated = await prisma.syncEntry.update({
        where: { id: existing.id },
        data: {
          relativePath,
          assetId: existing.assetId,
          sizeBytes: BigInt(tempResult.sizeBytes),
          contentHash: tempResult.checksumSha256,
          modifiedAtClient: input.modifiedAtClient ?? new Date(),
          syncState: "ACTIVE",
          deletedAt: null,
        },
      })
      await refreshBackupCounters(prisma, input.root.profileId)
      return updated
    }

    const prefs = await loadUserPreferences(prisma, input.userId)
    const wantsDocumentThumbnail =
      !requiresWorkerProcessing(analysis.mediaType) &&
      prefs.media.documentThumbnails &&
      assetSupportsDocumentThumbnail(
        analysis.mediaType,
        analysis.mimeType,
        analysis.extension,
        name,
      )

    const committed = await commitUpload(prisma, {
      storage: {
        existingStorageObjectId: existingStorageObject?.id ?? null,
        storageLocationId: library.storageLocationId,
        objectKey,
        physicalPath,
        sizeBytes: tempResult.sizeBytes,
        checksumSha256: tempResult.checksumSha256,
        mimeType: analysis.mimeType,
      },
      asset: {
        libraryId: library.id,
        folderId,
        ownerId: input.userId,
        filename: `${tempResult.checksumSha256}.${analysis.extension || "bin"}`,
        originalFilename: name,
        mimeType: analysis.mimeType,
        mediaType: analysis.mediaType,
        extension: analysis.extension || "bin",
        durationSeconds: analysis.durationSeconds,
        width: analysis.width,
        height: analysis.height,
        codec: analysis.codec,
        uploadClient: "backup",
      },
      uploadSession: {
        userId: input.userId,
        originalFilename: name,
        targetLibraryId: library.id,
        targetFolderId: folderId,
      },
      jobNames: {
        extractMetadata: JOB_TYPES.extractMetadata,
        generateThumbnail: JOB_TYPES.generateThumbnail,
      },
      wantsDocumentThumbnail,
    })

    await dispatchPendingForUpload(
      prisma,
      { media: mediaQueue },
      committed.pendingJobs,
      input.log,
    ).catch(() => {})

    const entry = await prisma.syncEntry.upsert({
      where: {
        syncRootId_clientEntryId: {
          syncRootId: input.root.id,
          clientEntryId: input.clientEntryId,
        },
      },
      create: {
        syncRootId: input.root.id,
        clientEntryId: input.clientEntryId,
        relativePath,
        entryType: "FILE",
        assetId: committed.assetId,
        sizeBytes: BigInt(tempResult.sizeBytes),
        contentHash: tempResult.checksumSha256,
        modifiedAtClient: input.modifiedAtClient ?? new Date(),
        syncState: "ACTIVE",
      },
      update: {
        relativePath,
        entryType: "FILE",
        assetId: committed.assetId,
        sizeBytes: BigInt(tempResult.sizeBytes),
        contentHash: tempResult.checksumSha256,
        modifiedAtClient: input.modifiedAtClient ?? new Date(),
        syncState: "ACTIVE",
        deletedAt: null,
      },
    })
    await refreshBackupCounters(prisma, input.root.profileId)
    return entry
  } catch (error) {
    if (tempPath) await removeTempFile(tempPath).catch(() => {})
    if (error instanceof BackupError) throw error
    if (error instanceof UploadTooLargeError) {
      throw new BackupError("UPLOAD_TOO_LARGE", "The file exceeds the upload size limit.", 413)
    }
    throw error
  }
}
