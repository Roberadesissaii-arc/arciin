import type { FastifyInstance } from "fastify"

import { requireSessionRole } from "@/services/security/auth"

// Tables exposed through the admin browser — order determines display order
const TABLES = [
  { name: "users",           label: "Users",           description: "Operator accounts with roles and status" },
  { name: "sessions",        label: "Sessions",         description: "Active httpOnly session tokens" },
  { name: "api-keys",        label: "API Keys",         description: "Hashed API keys with scopes" },
  { name: "libraries",       label: "Libraries",        description: "Default and custom library buckets" },
  { name: "folders",         label: "Folders",          description: "Folder hierarchy inside libraries" },
  { name: "assets",          label: "Assets",           description: "All managed media and document files" },
  { name: "storage-objects", label: "Storage Objects",  description: "Physical objects on disk" },
  { name: "activity-events", label: "Activity Events",  description: "Full instance activity log" },
  { name: "jobs",            label: "Jobs",             description: "BullMQ background job records" },
  { name: "integrations",    label: "Integrations",     description: "External service connections" },
  { name: "app-databases", label: "App Data Databases", description: "Logical stores for API JSON records" },
  { name: "app-database-folders", label: "App Data Folders", description: "Folder trees inside app data databases" },
  { name: "app-database-records", label: "App Data Records", description: "Named JSON documents per folder" },
  { name: "instance-config", label: "Instance Config", description: "Instance-level settings" },
]

async function countForTable(fastify: FastifyInstance, name: string): Promise<number> {
  try {
    switch (name) {
      case "users":           return await fastify.prisma.user.count()
      case "sessions":        return await fastify.prisma.session.count()
      case "api-keys":        return await fastify.prisma.apiKey.count()
      case "libraries":       return await fastify.prisma.library.count()
      case "folders":         return await fastify.prisma.folder.count()
      case "assets":          return await fastify.prisma.asset.count()
      case "storage-objects": return await fastify.prisma.storageObject.count()
      case "activity-events": return await fastify.prisma.activityEvent.count()
      case "jobs":            return await fastify.prisma.job.count()
      case "integrations":    return await fastify.prisma.integration.count()
      case "app-databases": return await fastify.prisma.appDatabase.count()
      case "app-database-folders": return await fastify.prisma.appDatabaseFolder.count()
      case "app-database-records": return await fastify.prisma.appDatabaseRecord.count()
      case "instance-config": return await fastify.prisma.instanceConfig.count()
      default: return 0
    }
  } catch {
    return 0
  }
}

function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
    ),
  )
}

async function rowsForTable(
  fastify: FastifyInstance,
  name: string,
  skip: number,
  take: number,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  switch (name) {
    case "users": {
      const [rows, total] = await Promise.all([
        fastify.prisma.user.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true },
        }),
        fastify.prisma.user.count(),
      ])
      return { rows, total }
    }
    case "sessions": {
      const [rows, total] = await Promise.all([
        fastify.prisma.session.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, userId: true, expiresAt: true, createdAt: true },
        }),
        fastify.prisma.session.count(),
      ])
      return { rows, total }
    }
    case "api-keys": {
      const [rows, total] = await Promise.all([
        fastify.prisma.apiKey.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
        }),
        fastify.prisma.apiKey.count(),
      ])
      return { rows, total }
    }
    case "libraries": {
      const [rows, total] = await Promise.all([
        fastify.prisma.library.findMany({
          skip, take,
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, slug: true, kind: true, storageLocationId: true, createdAt: true, updatedAt: true },
        }),
        fastify.prisma.library.count(),
      ])
      return { rows, total }
    }
    case "folders": {
      const [rows, total] = await Promise.all([
        fastify.prisma.folder.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, slug: true, libraryId: true, parentFolderId: true, pathCache: true, createdAt: true },
        }),
        fastify.prisma.folder.count(),
      ])
      return { rows, total }
    }
    case "assets": {
      const [rows, total] = await Promise.all([
        fastify.prisma.asset.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, originalFilename: true, mediaType: true, mimeType: true, sizeBytes: true, status: true, libraryId: true, folderId: true, createdAt: true },
        }),
        fastify.prisma.asset.count(),
      ])
      return { rows: sanitizeRows(rows as Record<string, unknown>[]), total }
    }
    case "storage-objects": {
      const [rows, total] = await Promise.all([
        fastify.prisma.storageObject.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, objectKey: true, physicalPath: true, sizeBytes: true, storageLocationId: true, createdAt: true },
        }),
        fastify.prisma.storageObject.count(),
      ])
      return { rows: sanitizeRows(rows as Record<string, unknown>[]), total }
    }
    case "activity-events": {
      const [rows, total] = await Promise.all([
        fastify.prisma.activityEvent.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, title: true, message: true, entityType: true, userId: true, createdAt: true },
        }),
        fastify.prisma.activityEvent.count(),
      ])
      return { rows, total }
    }
    case "jobs": {
      const [rows, total] = await Promise.all([
        fastify.prisma.job.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, status: true, progress: true, error: true, createdAt: true, completedAt: true },
        }),
        fastify.prisma.job.count(),
      ])
      return { rows, total }
    }
    case "integrations": {
      const [rows, total] = await Promise.all([
        fastify.prisma.integration.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, name: true, enabled: true, createdAt: true, updatedAt: true },
        }),
        fastify.prisma.integration.count(),
      ])
      return { rows, total }
    }
    case "app-databases": {
      const [rows, total] = await Promise.all([
        fastify.prisma.appDatabase.findMany({
          skip,
          take,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            createdById: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        fastify.prisma.appDatabase.count(),
      ])
      return { rows, total }
    }
    case "app-database-folders": {
      const [rows, total] = await Promise.all([
        fastify.prisma.appDatabaseFolder.findMany({
          skip,
          take,
          orderBy: { pathCache: "asc" },
          select: {
            id: true,
            databaseId: true,
            parentFolderId: true,
            name: true,
            slug: true,
            pathCache: true,
            deletedAt: true,
            createdAt: true,
          },
        }),
        fastify.prisma.appDatabaseFolder.count(),
      ])
      return { rows, total }
    }
    case "app-database-records": {
      const [rows, total] = await Promise.all([
        fastify.prisma.appDatabaseRecord.findMany({
          skip,
          take,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            folderId: true,
            name: true,
            mimeType: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        fastify.prisma.appDatabaseRecord.count(),
      ])
      return { rows, total }
    }
    case "instance-config": {
      const [rows, total] = await Promise.all([
        fastify.prisma.instanceConfig.findMany({
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, instanceName: true, storageRoot: true, publicUrl: true, remoteAccessMode: true, initializedAt: true, createdAt: true },
        }),
        fastify.prisma.instanceConfig.count(),
      ])
      return { rows, total }
    }
    default:
      return { rows: [], total: 0 }
  }
}

export async function registerAdminRoutes(fastify: FastifyInstance) {
  // GET /admin/tables — list all tables with counts
  fastify.get(
    "/admin/tables",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const tables = await Promise.all(
        TABLES.map(async (t) => ({
          ...t,
          count: await countForTable(fastify, t.name),
        }))
      )
      reply.send({ data: tables })
    }
  )

  // GET /admin/tables/:table?page=1&limit=20 — paginated rows
  fastify.get<{ Params: { table: string }; Querystring: { page?: string; limit?: string } }>(
    "/admin/tables/:table",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const { table } = request.params
      const page  = Math.max(1, parseInt(request.query.page  ?? "1",  10))
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit ?? "20", 10)))
      const skip  = (page - 1) * limit

      if (!TABLES.find((t) => t.name === table)) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Table not found." } })
        return
      }

      const { rows, total } = await rowsForTable(fastify, table, skip, limit)
      const totalPages = Math.max(1, Math.ceil(total / limit))

      reply.send({ data: { rows, total, page, totalPages, limit } })
    }
  )
}
