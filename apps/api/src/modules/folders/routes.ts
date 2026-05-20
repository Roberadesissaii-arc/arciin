import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeFolder } from "@/services/serializers"
import { slugify } from "@/services/slug"

const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  /** Omit field, or send null / "" for a root-level folder in the library. */
  parentFolderId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().optional(),
  ),
})

const updateFolderSchema = z.object({
  name: z.string().min(1).max(100),
})

async function updateDescendantPaths(
  fastify: FastifyInstance,
  libraryId: string,
  oldPath: string,
  newPath: string
) {
  const descendants = await fastify.prisma.folder.findMany({
    where: {
      libraryId,
      pathCache: {
        startsWith: `${oldPath}/`,
      },
    },
  })

  await Promise.all(
    descendants.map((folder) =>
      fastify.prisma.folder.update({
        where: {
          id: folder.id,
        },
        data: {
          pathCache: folder.pathCache.replace(oldPath, newPath),
        },
      })
    )
  )
}

export async function registerFolderRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/libraries/:libraryId/folders",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["libraries:read"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ libraryId: z.string() }).parse(request.params)
      const folders = await fastify.prisma.folder.findMany({
        where: {
          libraryId: params.libraryId,
          deletedAt: null,
        },
        orderBy: {
          pathCache: "asc",
        },
        include: {
          _count: {
            select: { assets: { where: { deletedAt: null } } },
          },
        },
        take: 500,
      })

      reply.send({
        data: folders.map((f) => serializeFolder(f, f._count.assets)),
      })
    }
  )

  fastify.post(
    "/libraries/:libraryId/folders",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["libraries:write"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ libraryId: z.string() }).parse(request.params)
      const parsed = createFolderSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid folder payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const parent = parsed.data.parentFolderId
        ? await fastify.prisma.folder.findUnique({
            where: {
              id: parsed.data.parentFolderId,
            },
          })
        : null

      const slug = slugify(parsed.data.name)
      const pathCache = parent ? `${parent.pathCache}/${slug}` : slug

      const folder = await fastify.prisma.folder.create({
        data: {
          libraryId: params.libraryId,
          parentFolderId: parsed.data.parentFolderId,
          name: parsed.data.name,
          slug,
          pathCache,
        },
      })

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
          userId: request.auth.user.id,
          type: "folder.created",
          title: "Folder created",
          message: `${folder.name} was created.`,
          entityType: "folder",
          entityId: folder.id,
        })
      }

      reply.status(201).send({
        data: serializeFolder(folder),
      })
    }
  )

  fastify.patch(
    "/folders/:folderId",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["libraries:write"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ folderId: z.string() }).parse(request.params)
      const parsed = updateFolderSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid folder payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await fastify.prisma.folder.findUnique({
        where: {
          id: params.folderId,
        },
      })

      if (!existing) {
        reply.status(404).send({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "Folder not found.",
          },
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

      const updated = await fastify.prisma.folder.update({
        where: {
          id: existing.id,
        },
        data: {
          name: parsed.data.name,
          slug,
          pathCache: nextPath,
        },
      })

      if (existing.pathCache !== nextPath) {
        await updateDescendantPaths(fastify, existing.libraryId, existing.pathCache, nextPath)
      }

      reply.send({
        data: serializeFolder(updated),
      })
    }
  )

  const deleteFolderAuth = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["libraries:write"],
  )

  async function handleDeleteFolder(request: FastifyRequest, reply: FastifyReply) {
    const params = z.object({ folderId: z.string() }).parse(request.params)

    const existing = await fastify.prisma.folder.findUnique({
      where: {
        id: params.folderId,
      },
    })

    if (!existing) {
      reply.status(404).send({
        error: {
          code: "FOLDER_NOT_FOUND",
          message: "Folder not found.",
        },
      })
      return
    }

    await fastify.prisma.folder.updateMany({
      where: {
        OR: [
          { id: existing.id },
          {
            libraryId: existing.libraryId,
            pathCache: {
              startsWith: `${existing.pathCache}/`,
            },
          },
        ],
      },
      data: {
        deletedAt: new Date(),
      },
    })

    reply.send({
      data: {
        success: true,
      },
    })
  }

  fastify.delete("/folders/:folderId", { preHandler: deleteFolderAuth }, handleDeleteFolder)

  /** POST alias — iOS PWA often fails CORS preflight on DELETE. */
  fastify.post("/folders/:folderId/delete", { preHandler: deleteFolderAuth }, handleDeleteFolder)
}
