import type { FastifyInstance } from "fastify"
import type { Prisma } from "@prisma/client"
import { z } from "zod"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { requireFeature, requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import {
  serializeAppDatabase,
  serializeAppDatabaseFolder,
  serializeAppDatabaseRecord,
} from "@/services/serializers"
import { slugify } from "@/services/slug"

const createAppDatabaseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
})

const createAppFolderSchema = z.object({
  name: z.string().min(1).max(100),
  parentFolderId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().optional(),
  ),
})

const updateAppFolderSchema = z.object({
  name: z.string().min(1).max(100),
})

const createRecordSchema = z.object({
  name: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  mimeType: z.string().max(120).optional(),
})

const updateRecordSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  mimeType: z.string().max(120).nullable().optional(),
})

async function ensureUniqueDatabaseSlug(fastify: FastifyInstance, base: string) {
  const slug = slugify(base) || "database"
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`
    const taken = await fastify.prisma.appDatabase.findUnique({
      where: { slug: candidate },
      select: { id: true },
    })
    if (!taken) {
      return candidate
    }
  }
  return `${slugify(base) || "database"}-${Date.now()}`
}

async function updateAppFolderDescendantPaths(
  fastify: FastifyInstance,
  databaseId: string,
  oldPath: string,
  newPath: string
) {
  const descendants = await fastify.prisma.appDatabaseFolder.findMany({
    where: {
      databaseId,
      pathCache: {
        startsWith: `${oldPath}/`,
      },
      deletedAt: null,
    },
  })

  await Promise.all(
    descendants.map((folder) =>
      fastify.prisma.appDatabaseFolder.update({
        where: { id: folder.id },
        data: {
          pathCache: folder.pathCache.replace(oldPath, newPath),
        },
      })
    )
  )
}

export async function registerAppDatabaseRoutes(fastify: FastifyInstance) {
  const readDatabases = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
    ["appdata:databases:read"]
  )
  const writeDatabases = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["appdata:databases:write"]
  )
  const deleteDatabases = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["appdata:databases:delete"]
  )
  const readFolders = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
    ["appdata:folders:read", "appdata:databases:read"]
  )
  const writeFolders = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["appdata:folders:write"]
  )
  const deleteFolders = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["appdata:folders:delete"]
  )
  const readRecords = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
    ["appdata:records:read", "appdata:folders:read", "appdata:databases:read"]
  )
  const writeRecords = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["appdata:records:write"]
  )
  const deleteRecords = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["appdata:records:delete"]
  )

  fastify.get(
    "/app-databases",
    { preHandler: [readDatabases, requireFeature("developer.app_databases")] },
    async (_request, reply) => {
      const list = await fastify.prisma.appDatabase.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              folders: true,
            },
          },
        },
        take: 100,
      })

      reply.send({
        data: list.map((d) => serializeAppDatabase(d)),
      })
    }
  )

  fastify.post(
    "/app-databases",
    { preHandler: [writeDatabases, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const parsed = createAppDatabaseSchema.safeParse(request.body)
      if (!parsed.success || !request.auth) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid app database payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const userId = request.auth.user.id
      const slug = await ensureUniqueDatabaseSlug(fastify, parsed.data.name)

      const db = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.appDatabase.create({
          data: {
            name: parsed.data.name.trim(),
            slug,
            description: parsed.data.description?.trim() || null,
            createdById: userId,
          },
        })

        const defaultSlug = slugify("Default") || "default"
        await tx.appDatabaseFolder.create({
          data: {
            databaseId: created.id,
            parentFolderId: null,
            name: "Default",
            slug: defaultSlug,
            pathCache: defaultSlug,
          },
        })

        return tx.appDatabase.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            _count: { select: { folders: true } },
          },
        })
      })

      await recordAndBroadcastActivity(fastify, {
        userId,
        type: "appdata.database.created",
        title: "App data database created",
        message: `${db.name} (${db.slug})`,
        entityType: "app-database",
        entityId: db.id,
      })

      reply.status(201).send({ data: serializeAppDatabase(db) })
    }
  )

  fastify.get(
    "/app-databases/:databaseId",
    { preHandler: [readDatabases, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ databaseId: z.string() }).parse(request.params)
      const db = await fastify.prisma.appDatabase.findUnique({
        where: { id: params.databaseId },
        include: { _count: { select: { folders: true } } },
      })

      if (!db) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "App database not found." },
        })
        return
      }

      reply.send({ data: serializeAppDatabase(db) })
    }
  )

  fastify.delete(
    "/app-databases/:databaseId",
    { preHandler: [deleteDatabases, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ databaseId: z.string() }).parse(request.params)
      const existing = await fastify.prisma.appDatabase.findUnique({
        where: { id: params.databaseId },
      })

      if (!existing) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "App database not found." },
        })
        return
      }

      await fastify.prisma.appDatabase.delete({
        where: { id: params.databaseId },
      })

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
          userId: request.auth.user.id,
          type: "appdata.database.deleted",
          title: "App data database deleted",
          message: existing.name,
          entityType: "app-database",
          entityId: existing.id,
        })
      }

      reply.send({ data: { success: true } })
    }
  )

  fastify.get(
    "/app-databases/:databaseId/tables",
    { preHandler: [readFolders, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ databaseId: z.string() }).parse(request.params)
      const db = await fastify.prisma.appDatabase.findUnique({
        where: { id: params.databaseId },
        select: { id: true },
      })

      if (!db) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "App database not found." },
        })
        return
      }

      const folders = await fastify.prisma.appDatabaseFolder.findMany({
        where: {
          databaseId: params.databaseId,
          deletedAt: null,
        },
        orderBy: { pathCache: "asc" },
        include: {
          _count: {
            select: {
              records: true,
              childFolders: true,
            },
          },
        },
        take: 500,
      })

      reply.send({
        data: folders.map((f) => serializeAppDatabaseFolder(f)),
      })
    }
  )

  fastify.post(
    "/app-databases/:databaseId/tables",
    { preHandler: [writeFolders, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ databaseId: z.string() }).parse(request.params)
      const parsed = createAppFolderSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid table payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const db = await fastify.prisma.appDatabase.findUnique({
        where: { id: params.databaseId },
        select: { id: true },
      })

      if (!db) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "App database not found." },
        })
        return
      }

      const parent = parsed.data.parentFolderId
        ? await fastify.prisma.appDatabaseFolder.findFirst({
            where: {
              id: parsed.data.parentFolderId,
              databaseId: params.databaseId,
              deletedAt: null,
            },
          })
        : null

      if (parsed.data.parentFolderId && !parent) {
        reply.status(400).send({
          error: { code: "INVALID_PARENT", message: "Parent folder not found in this database." },
        })
        return
      }

      const slug = slugify(parsed.data.name)
      const pathCache = parent ? `${parent.pathCache}/${slug}` : slug

      let folder
      try {
        folder = await fastify.prisma.appDatabaseFolder.create({
          data: {
            databaseId: params.databaseId,
            parentFolderId: parsed.data.parentFolderId ?? null,
            name: parsed.data.name,
            slug,
            pathCache,
          },
          include: {
            _count: {
              select: { records: true, childFolders: true },
            },
          },
        })
      } catch {
        reply.status(409).send({
          error: {
            code: "PATH_CONFLICT",
            message: "A table with this path already exists in this database.",
          },
        })
        return
      }

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
          userId: request.auth.user.id,
          type: "appdata.folder.created",
          title: "App data folder created",
          message: pathCache,
          entityType: "app-database-folder",
          entityId: folder.id,
        })
      }

      reply.status(201).send({ data: serializeAppDatabaseFolder(folder) })
    }
  )

  fastify.patch(
    "/app-database-tables/:tableId",
    { preHandler: [writeFolders, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ tableId: z.string() }).parse(request.params)
      const parsed = updateAppFolderSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid table payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await fastify.prisma.appDatabaseFolder.findFirst({
        where: { id: params.tableId, deletedAt: null },
      })

      if (!existing) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Table not found." },
        })
        return
      }

      const slug = slugify(parsed.data.name)
      const nextPath = existing.parentFolderId
        ? (() => {
            const index = existing.pathCache.lastIndexOf("/")
            return `${existing.pathCache.slice(0, index)}/${slug}`
          })()
        : slug

      const updated = await fastify.prisma.appDatabaseFolder.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          slug,
          pathCache: nextPath,
        },
        include: {
          _count: {
            select: { records: true, childFolders: true },
          },
        },
      })

      if (existing.pathCache !== nextPath) {
        await updateAppFolderDescendantPaths(
          fastify,
          existing.databaseId,
          existing.pathCache,
          nextPath
        )
      }

      reply.send({ data: serializeAppDatabaseFolder(updated) })
    }
  )

  fastify.delete(
    "/app-database-tables/:tableId",
    { preHandler: [deleteFolders, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ tableId: z.string() }).parse(request.params)

      const existing = await fastify.prisma.appDatabaseFolder.findFirst({
        where: { id: params.tableId, deletedAt: null },
      })

      if (!existing) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Table not found." },
        })
        return
      }

      await fastify.prisma.appDatabaseFolder.updateMany({
        where: {
          OR: [
            { id: existing.id },
            {
              databaseId: existing.databaseId,
              pathCache: {
                startsWith: `${existing.pathCache}/`,
              },
            },
          ],
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
      })

      reply.send({ data: { success: true } })
    }
  )

  fastify.get(
    "/app-database-tables/:tableId/rows",
    { preHandler: [readRecords, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ tableId: z.string() }).parse(request.params)

      const folder = await fastify.prisma.appDatabaseFolder.findFirst({
        where: { id: params.tableId, deletedAt: null },
      })

      if (!folder) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Table not found." },
        })
        return
      }

      const records = await fastify.prisma.appDatabaseRecord.findMany({
        where: { folderId: params.tableId },
        orderBy: { updatedAt: "desc" },
        take: 500,
      })

      reply.send({
        data: records.map(serializeAppDatabaseRecord),
      })
    }
  )

  fastify.post(
    "/app-database-tables/:tableId/rows",
    { preHandler: [writeRecords, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ tableId: z.string() }).parse(request.params)
      const parsed = createRecordSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid row payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const folder = await fastify.prisma.appDatabaseFolder.findFirst({
        where: { id: params.tableId, deletedAt: null },
      })

      if (!folder) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Table not found." },
        })
        return
      }

      let record
      try {
        record = await fastify.prisma.appDatabaseRecord.create({
          data: {
            folderId: params.tableId,
            name: parsed.data.name,
            payload: parsed.data.payload as Prisma.InputJsonValue,
            mimeType: parsed.data.mimeType ?? null,
          },
        })
      } catch {
        reply.status(409).send({
          error: {
            code: "NAME_CONFLICT",
            message: "A row with this name already exists in this table.",
          },
        })
        return
      }

      reply.status(201).send({ data: serializeAppDatabaseRecord(record) })
    }
  )

  fastify.patch(
    "/app-database-rows/:rowId",
    { preHandler: [writeRecords, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ rowId: z.string() }).parse(request.params)
      const parsed = updateRecordSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid row payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await fastify.prisma.appDatabaseRecord.findUnique({
        where: { id: params.rowId },
        include: { folder: true },
      })

      if (!existing || existing.folder.deletedAt) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Row not found." },
        })
        return
      }

      const updated = await fastify.prisma.appDatabaseRecord.update({
        where: { id: params.rowId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.payload !== undefined
            ? { payload: parsed.data.payload as Prisma.InputJsonValue }
            : {}),
          ...(parsed.data.mimeType !== undefined ? { mimeType: parsed.data.mimeType } : {}),
        },
      })

      reply.send({ data: serializeAppDatabaseRecord(updated) })
    }
  )

  fastify.delete(
    "/app-database-rows/:rowId",
    { preHandler: [deleteRecords, requireFeature("developer.app_databases")] },
    async (request, reply) => {
      const params = z.object({ rowId: z.string() }).parse(request.params)

      const existing = await fastify.prisma.appDatabaseRecord.findUnique({
        where: { id: params.rowId },
        include: { folder: true },
      })

      if (!existing || existing.folder.deletedAt) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Row not found." },
        })
        return
      }

      await fastify.prisma.appDatabaseRecord.delete({
        where: { id: params.rowId },
      })

      reply.send({ data: { success: true } })
    }
  )
}
