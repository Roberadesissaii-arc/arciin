import type { Prisma } from "@prisma/client"
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


export type TableSummaryMetric = {
  label: string
  value: number
  /** Drives the badge colour; "neutral" when the number is just a number. */
  tone: "neutral" | "success" | "warning" | "danger"
}

/**
 * The counts worth showing beside a table, computed from the rows themselves.
 *
 * A raw row count is not the same as how many of a thing currently work, and
 * the Database browser had no way to say so. "API Keys — 10 records" sat
 * beside a management page listing three, which reads as a discrepancy when it
 * is actually history: a revoked key keeps its row, with revokedAt set, and
 * that record is the audit trail. Deleting those to make the two numbers agree
 * would destroy the only evidence that a key ever existed.
 */
async function summaryForTable(
  fastify: FastifyInstance,
  name: string,
): Promise<TableSummaryMetric[]> {
  const now = new Date()
  try {
    switch (name) {
      case "api-keys": {
        const [total, revoked, expired] = await Promise.all([
          fastify.prisma.apiKey.count(),
          fastify.prisma.apiKey.count({ where: { revokedAt: { not: null } } }),
          fastify.prisma.apiKey.count({
            where: { revokedAt: null, expiresAt: { not: null, lt: now } },
          }),
        ])
        return [
          { label: "historical records", value: total, tone: "neutral" },
          { label: "active", value: total - revoked - expired, tone: "success" },
          { label: "revoked", value: revoked, tone: "danger" },
          { label: "expired", value: expired, tone: "warning" },
        ]
      }
      case "users": {
        const [total, active, owners] = await Promise.all([
          fastify.prisma.user.count(),
          fastify.prisma.user.count({ where: { status: "ACTIVE" } }),
          fastify.prisma.user.count({ where: { role: "OWNER" } }),
        ])
        return [
          { label: total === 1 ? "user" : "users", value: total, tone: "neutral" },
          { label: "active", value: active, tone: "success" },
          { label: owners === 1 ? "owner" : "owners", value: owners, tone: "neutral" },
        ]
      }
      case "sessions": {
        const [total, live] = await Promise.all([
          fastify.prisma.session.count(),
          fastify.prisma.session.count({ where: { expiresAt: { gt: now } } }),
        ])
        return [
          { label: "records", value: total, tone: "neutral" },
          { label: "unexpired", value: live, tone: "success" },
          { label: "expired", value: total - live, tone: "warning" },
        ]
      }
      case "assets": {
        const [total, trashed, archived] = await Promise.all([
          fastify.prisma.asset.count(),
          fastify.prisma.asset.count({ where: { deletedAt: { not: null } } }),
          fastify.prisma.asset.count({ where: { archivedAt: { not: null }, deletedAt: null } }),
        ])
        return [
          { label: "records", value: total, tone: "neutral" },
          { label: "active", value: total - trashed - archived, tone: "success" },
          { label: "archived", value: archived, tone: "warning" },
          { label: "in trash", value: trashed, tone: "danger" },
        ]
      }
      case "folders": {
        const [total, deleted] = await Promise.all([
          fastify.prisma.folder.count(),
          fastify.prisma.folder.count({ where: { deletedAt: { not: null } } }),
        ])
        return [
          { label: "records", value: total, tone: "neutral" },
          { label: "live", value: total - deleted, tone: "success" },
          { label: "deleted", value: deleted, tone: "danger" },
        ]
      }
      case "jobs": {
        const total = await fastify.prisma.job.count()
        return [{ label: "records", value: total, tone: "neutral" }]
      }
      default:
        return [{ label: "records", value: await countForTable(fastify, name), tone: "neutral" }]
    }
  } catch {
    return [{ label: "records", value: 0, tone: "neutral" }]
  }
}

function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
    ),
  )
}

export const API_KEY_STATUS_FILTERS = ["all", "active", "revoked", "expired"] as const
export type ApiKeyStatusFilter = (typeof API_KEY_STATUS_FILTERS)[number]

/**
 * The Database → API Keys filter, as a where clause.
 *
 * Same rule as the derived `status` column below: revocation wins over
 * expiry, and a null expiry never expires. Filtering in the database keeps
 * paging and the row total honest — filtering one page in the browser would
 * show "3 revoked" while twenty more sat on other pages.
 */
export function apiKeyStatusWhere(filter: ApiKeyStatusFilter, now: Date): Prisma.ApiKeyWhereInput {
  switch (filter) {
    case "revoked":
      return { revokedAt: { not: null } }
    case "expired":
      return { revokedAt: null, expiresAt: { not: null, lt: now } }
    case "active":
      return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }
    default:
      return {}
  }
}

async function rowsForTable(
  fastify: FastifyInstance,
  name: string,
  skip: number,
  take: number,
  filters: { apiKeyStatus?: ApiKeyStatusFilter } = {},
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
      const where = apiKeyStatusWhere(filters.apiKeyStatus ?? "all", new Date())
      const [rows, total] = await Promise.all([
        fastify.prisma.apiKey.findMany({
          where,
          skip, take,
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
        }),
        fastify.prisma.apiKey.count({ where }),
      ])
      /**
       * A derived status, computed here rather than in the browser.
       *
       * revokedAt and expiresAt are both already on the row, so a reader could
       * work it out — but only by knowing that revocation wins over expiry and
       * that a null expiry means forever. Deciding that once, on the server,
       * keeps the Database view and anything else that asks from drifting
       * apart. keyHash is not selected and never has been.
       */
      const now = Date.now()
      return {
        rows: rows.map((row) => ({
          ...row,
          status: row.revokedAt
            ? "Revoked"
            : row.expiresAt && row.expiresAt.getTime() < now
              ? "Expired"
              : "Active",
        })),
        total,
      }
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
          summary: await summaryForTable(fastify, t.name),
        }))
      )
      reply.send({ data: tables })
    }
  )

  // GET /admin/tables/:table?page=1&limit=20 — paginated rows
  fastify.get<{ Params: { table: string }; Querystring: { page?: string; limit?: string; status?: string } }>(
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

      const status = request.query.status ?? "all"
      if (!(API_KEY_STATUS_FILTERS as readonly string[]).includes(status)) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "status must be all, active, revoked, or expired." },
        })
        return
      }

      const { rows, total } = await rowsForTable(fastify, table, skip, limit, {
        apiKeyStatus: table === "api-keys" ? (status as ApiKeyStatusFilter) : undefined,
      })
      const totalPages = Math.max(1, Math.ceil(total / limit))

      reply.send({ data: { rows, total, page, totalPages, limit } })
    }
  )
}
