import type {
  ActivityEvent,
  ApiKey,
  Asset,
  Folder,
  Integration,
  Job,
  Library,
  Session,
  StorageLocation,
  UploadSession,
  User,
} from "@prisma/client"

export function serializeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

export function serializeSession(session: Session) {
  return {
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
  }
}

export function serializeAuth(user: User, session: Session) {
  return {
    user: serializeUser(user),
    session: serializeSession(session),
  }
}

export function serializeLibrary(
  library: Library & {
    _count?: {
      assets?: number
      folders?: number
    }
  }
) {
  return {
    id: library.id,
    name: library.name,
    slug: library.slug,
    description: library.description,
    kind: library.kind,
    icon: library.icon,
    color: library.color,
    storageLocationId: library.storageLocationId,
    assetCount: library._count?.assets ?? 0,
    folderCount: library._count?.folders ?? 0,
    createdAt: library.createdAt.toISOString(),
    updatedAt: library.updatedAt.toISOString(),
  }
}

export function serializeFolder(folder: Folder, assetCount = 0) {
  return {
    id: folder.id,
    libraryId: folder.libraryId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    slug: folder.slug,
    pathCache: folder.pathCache,
    assetCount,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    deletedAt: folder.deletedAt?.toISOString() ?? null,
  }
}

export function serializeAsset(asset: Asset) {
  return {
    id: asset.id,
    libraryId: asset.libraryId,
    folderId: asset.folderId,
    storageObjectId: asset.storageObjectId,
    ownerId: asset.ownerId,
    filename: asset.filename,
    originalFilename: asset.originalFilename,
    title: asset.title,
    description: asset.description,
    mimeType: asset.mimeType,
    mediaType: asset.mediaType,
    extension: asset.extension,
    sizeBytes: Number(asset.sizeBytes),
    checksumSha256: asset.checksumSha256,
    durationSeconds: asset.durationSeconds,
    width: asset.width,
    height: asset.height,
    codec: asset.codec,
    status: asset.status,
    processingError: asset.processingError,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    deletedAt: asset.deletedAt?.toISOString() ?? null,
  }
}

export function serializeUpload(
  upload: UploadSession & {
    targetLibrary?: Library | null
  }
) {
  return {
    id: upload.id,
    userId: upload.userId,
    originalFilename: upload.originalFilename,
    mimeType: upload.mimeType,
    sizeBytes: Number(upload.sizeBytes),
    status: upload.status,
    progress: upload.progress,
    targetLibraryId: upload.targetLibraryId,
    targetFolderId: upload.targetFolderId,
    detectedMediaType: upload.detectedMediaType,
    assetId: upload.assetId,
    error: upload.error,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString(),
    completedAt: upload.completedAt?.toISOString() ?? null,
    targetLibrary: upload.targetLibrary ? serializeLibrary(upload.targetLibrary) : null,
  }
}

export function serializeJob(job: Job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    payload: job.payload,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  }
}

export function serializeActivity(event: ActivityEvent) {
  return {
    id: event.id,
    userId: event.userId,
    type: event.type,
    title: event.title,
    message: event.message,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  }
}

export function serializeApiKey(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
  }
}

export function serializeIntegration(integration: Integration) {
  return {
    id: integration.id,
    type: integration.type,
    name: integration.name,
    enabled: integration.enabled,
    config: integration.config,
    createdAt: integration.createdAt.toISOString(),
    updatedAt: integration.updatedAt.toISOString(),
  }
}

export function serializeStorageLocation(storageLocation: StorageLocation) {
  return {
    id: storageLocation.id,
    name: storageLocation.name,
    type: storageLocation.type,
    rootPath: storageLocation.rootPath,
    isDefault: storageLocation.isDefault,
    createdAt: storageLocation.createdAt.toISOString(),
    updatedAt: storageLocation.updatedAt.toISOString(),
  }
}
