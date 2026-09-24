import type {
  ActivityEvent,
  ApiKey,
  AppDatabase,
  AppDatabaseFolder,
  AppDatabaseRecord,
  Asset,
  Folder,
  Integration,
  Job,
  Library,
  Session,
  ShareLink,
  StorageLocation,
  UploadSession,
  User,
} from "@prisma/client"

function serializeDocumentInsight(value: unknown) {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const summary = typeof row.summary === "string" ? row.summary : ""
  const keywords = Array.isArray(row.keywords)
    ? row.keywords.filter((k): k is string => typeof k === "string")
    : []
  const links = Array.isArray(row.links)
    ? row.links.filter((k): k is string => typeof k === "string")
    : []
  const topics = Array.isArray(row.topics)
    ? row.topics.filter((k): k is string => typeof k === "string")
    : []
  let about: { kind: string; title: string; note: string | null } | null = null
  if (row.about && typeof row.about === "object") {
    const a = row.about as Record<string, unknown>
    const title = typeof a.title === "string" ? a.title.trim() : ""
    if (title) {
      about = {
        kind: typeof a.kind === "string" ? a.kind : "other",
        title,
        note: typeof a.note === "string" && a.note.trim() ? a.note.trim() : null,
      }
    }
  }
  if (!summary && keywords.length === 0 && links.length === 0 && !about && topics.length === 0) {
    return null
  }
  return {
    summary,
    keywords,
    links,
    about,
    topics,
    model: typeof row.model === "string" ? row.model : null,
    generatedAt: typeof row.generatedAt === "string" ? row.generatedAt : null,
  }
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarPath ? `/api/auth/users/${user.id}/avatar` : null,
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
    /**
     * Bound Device for this user session, taken only from Session.pairedDeviceId.
     * Null in a normal browser. Desktop should re-login (user session only) when
     * this is null or does not match its own Device.id — never revoke or re-pair.
     */
    pairedDeviceId: session.pairedDeviceId ?? null,
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
  },
  /**
   * Visible asset total. Pass the value from `countVisibleAssetsByLibrary` so
   * the count agrees with what the library page lists; the `_count.assets`
   * fallback counts every non-deleted asset and is only used where an exact
   * visible total is not required.
   */
  visibleAssetCount?: number,
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
    assetCount: visibleAssetCount ?? library._count?.assets ?? 0,
    folderCount: library._count?.folders ?? 0,
    createdAt: library.createdAt.toISOString(),
    updatedAt: library.updatedAt.toISOString(),
  }
}

export function serializeFolder(
  folder: Folder,
  assetCount = 0,
  access?: { isLocked: boolean; accessGranted: boolean },
) {
  const isLocked = access?.isLocked ?? Boolean(folder.lockedAt)
  const accessGranted = access?.accessGranted ?? !isLocked
  return {
    id: folder.id,
    libraryId: folder.libraryId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    slug: folder.slug,
    pathCache: folder.pathCache,
    assetCount,
    isRemote: Boolean(folder.isRemote),
    hideFromAllFiles: Boolean(folder.hideFromAllFiles),
    isLocked,
    accessGranted,
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
    pageCount: asset.pageCount ?? null,
    documentAuthor: asset.documentAuthor ?? null,
    documentSubject: asset.documentSubject ?? null,
    documentInsight: serializeDocumentInsight(asset.documentInsight),
    status: asset.status,
    processingError: asset.processingError,
    importSourceUrl: asset.importSourceUrl,
    uploadClient: asset.uploadClient,
    badgeLabel: asset.badgeLabel,
    badgeColor: asset.badgeColor,
    // The card uses this to decide whether to ask the server for a thumbnail
    // instead of rendering the PDF's first page itself.
    coverImageAt: asset.coverImageAt ? asset.coverImageAt.toISOString() : null,
    showBadge: asset.showBadge,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    deletedAt: asset.deletedAt?.toISOString() ?? null,
    archivedAt: asset.archivedAt?.toISOString() ?? null,
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
    /** Null = created before per-key limits; only the instance limit applies. */
    rateLimitPerMinute: apiKey.rateLimitPerMinute ?? null,
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

export function serializeAppDatabase(
  db: AppDatabase & {
    _count?: { folders: number; records?: number }
  }
) {
  return {
    id: db.id,
    name: db.name,
    slug: db.slug,
    description: db.description,
    createdById: db.createdById,
    folderCount: db._count?.folders ?? 0,
    createdAt: db.createdAt.toISOString(),
    updatedAt: db.updatedAt.toISOString(),
  }
}

export function serializeAppDatabaseFolder(
  folder: AppDatabaseFolder & {
    _count?: { records?: number; childFolders?: number }
  }
) {
  return {
    id: folder.id,
    databaseId: folder.databaseId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    slug: folder.slug,
    pathCache: folder.pathCache,
    recordCount: folder._count?.records ?? 0,
    childFolderCount: folder._count?.childFolders ?? 0,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    deletedAt: folder.deletedAt?.toISOString() ?? null,
  }
}

export function serializeAppDatabaseRecord(record: AppDatabaseRecord) {
  return {
    id: record.id,
    folderId: record.folderId,
    name: record.name,
    payload: record.payload,
    mimeType: record.mimeType,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export function serializeShareLink(
  share: ShareLink & {
    asset?: { originalFilename: string; title: string | null } | null
    folder?: { name: string } | null
    _count?: { shareAssets: number }
  },
) {
  const resourceName =
    share.resourceType === "ASSET"
      ? share.asset?.title?.trim() || share.asset?.originalFilename || "File"
      : share.resourceType === "ASSETS"
        ? share._count?.shareAssets === 1
          ? "1 file"
          : `${share._count?.shareAssets ?? 0} files`
        : share.folder?.name || "Folder"

  return {
    id: share.id,
    resourceType: share.resourceType,
    assetId: share.assetId,
    folderId: share.folderId,
    assetCount: share.resourceType === "ASSETS" ? share._count?.shareAssets ?? 0 : undefined,
    tokenPrefix: share.tokenPrefix,
    label: share.label ?? resourceName,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxViews: share.maxViews,
    viewCount: share.viewCount,
    allowDownload: share.allowDownload,
    lastViewedAt: share.lastViewedAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
  }
}
