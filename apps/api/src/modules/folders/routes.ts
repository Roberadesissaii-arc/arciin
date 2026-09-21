import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import {
  folderAccessGranted,
  folderIsLocked,
  grantFolderSessionAccess,
  verifyFolderAccessCredential,
} from "@/services/folders/folder-lock"
import { setFolderHideFromAllFilesCascade } from "@/services/folders/hidden-from-all-files"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeFolder } from "@/services/serializers"
import { slugify } from "@/services/slug"

const folderCredentialSchema = z
  .object({
    password: z.string().min(1).max(512).optional(),
    pin: z.string().regex(/^\d{6}$/).optional(),
  })
  .refine((body) => Boolean(body.password) !== Boolean(body.pin), {
    message: "Provide account password or 6-digit PIN.",
  })

const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  /** Omit field, or send null / "" for a root-level folder in the library. */
  parentFolderId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().optional(),
  ),
})

const updateFolderSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    hideFromAllFiles: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.hideFromAllFiles !== undefined, {
    message: "Provide a name and/or hideFromAllFiles.",
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

      const userId = request.auth!.user.id
      const session = request.auth?.session ?? null

      reply.send({
        data: folders.map((f) =>
          serializeFolder(f, f._count.assets, {
            isLocked: folderIsLocked(f),
            accessGranted: folderAccessGranted(request, userId, f, session),
          }),
        ),
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
      const createdViaApi = Boolean(request.auth?.apiKeyId)

      const folder = await fastify.prisma.folder.create({
        data: {
          libraryId: params.libraryId,
          parentFolderId: parsed.data.parentFolderId,
          name: parsed.data.name,
          slug,
          pathCache,
          isRemote: createdViaApi,
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


      const nextName = parsed.data.name?.trim()
      const renameRequested = nextName !== undefined && nextName !== existing.name

      let slug = existing.slug
      let nextPath = existing.pathCache

      if (renameRequested && nextName) {
        slug = slugify(nextName)
        nextPath = existing.parentFolderId
          ? (() => {
              const index = existing.pathCache.lastIndexOf("/")
              return `${existing.pathCache.slice(0, index)}/${slug}`
            })()
          : slug
      }

      let working = existing

      if (renameRequested && nextName) {
        working = await fastify.prisma.folder.update({
          where: { id: existing.id },
          data: {
            name: nextName,
            slug,
            pathCache: nextPath,
          },
        })

        if (existing.pathCache !== nextPath) {
          await updateDescendantPaths(fastify, existing.libraryId, existing.pathCache, nextPath)
        }
      }

      // Hide/show cascades to every nested folder so All Files drops the whole tree.
      if (parsed.data.hideFromAllFiles !== undefined) {
        working = await setFolderHideFromAllFilesCascade(
          fastify.prisma,
          {
            id: working.id,
            libraryId: working.libraryId,
            pathCache: working.pathCache,
          },
          parsed.data.hideFromAllFiles,
        )
      }

      reply.send({
        data: serializeFolder(working),
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


    /**
     * Deleting a folder must not take its files with it.
     *
     * The confirmation says "Files stay in place until you delete them
     * separately", and that was untrue: only the folder rows were soft-deleted,
     * so every asset kept pointing at a deleted folder. Listings exclude assets
     * whose folder is deleted, and Trash only shows assets with their own
     * deletedAt — so the file was in neither. It was alive in the database,
     * present on disk, and unreachable from every screen, with no way back.
     *
     * Reparenting to the library root is what "stay in place" means: the files
     * remain exactly where the dialog says they will be. Both writes are one
     * transaction, so a failure cannot leave assets pointing at a folder that
     * is already gone.
     */
    const doomed = await fastify.prisma.folder.findMany({
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
      select: { id: true },
    })
    const folderIds = doomed.map((f) => f.id)

    const rescued = await fastify.prisma.$transaction(async (tx) => {
      const moved = await tx.asset.updateMany({
        where: { folderId: { in: folderIds }, deletedAt: null },
        data: { folderId: null },
      })

      await tx.folder.updateMany({
        where: { id: { in: folderIds } },
        data: { deletedAt: new Date() },
      })

      return moved.count
    })

    if (rescued > 0 && request.auth) {
      await recordAndBroadcastActivity(fastify, {
        userId: request.auth.user.id,
        type: "assets.moved",
        title: "Files moved to the library root",
        message: `${existing.name} was deleted; ${rescued} file${
          rescued === 1 ? "" : "s"
        } moved to the library root.`,
        entityType: "folder",
        entityId: existing.id,
      })
    }

    reply.send({
      data: {
        success: true,
        foldersDeleted: folderIds.length,
        assetsMovedToRoot: rescued,
      },
    })
  }

  fastify.delete("/folders/:folderId", { preHandler: deleteFolderAuth }, handleDeleteFolder)

  /** POST alias — iOS PWA often fails CORS preflight on DELETE. */
  fastify.post("/folders/:folderId/delete", { preHandler: deleteFolderAuth }, handleDeleteFolder)

  const folderLockAuth = requireSessionRolesOrApiKeyScopes(
    ["OWNER", "ADMIN", "MEMBER"],
    ["libraries:write"],
  )

  fastify.post(
    "/folders/:folderId/lock",
    { preHandler: folderLockAuth },
    async (request, reply) => {
      const params = z.object({ folderId: z.string() }).parse(request.params)
      const parsed = folderCredentialSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Password or PIN required to lock folder." },
        })
        return
      }

      const existing = await fastify.prisma.folder.findUnique({
        where: { id: params.folderId },
      })
      if (!existing || existing.deletedAt) {
        reply.status(404).send({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { aiConfig: true },
      })
      const userId = request.auth!.user.id
      const verified = await verifyFolderAccessCredential(
        fastify,
        userId,
        parsed.data,
        instance?.aiConfig,
      )
      if (!verified.ok) {
        reply.status(401).send({
          error: {
            code: verified.code,
            message:
              verified.code === "INVALID_PIN"
                ? "Incorrect vault PIN."
                : "Incorrect account password.",
          },
        })
        return
      }

      const updated = await fastify.prisma.folder.update({
        where: { id: existing.id },
        data: {
          lockedAt: new Date(),
          lockedByUserId: userId,
        },
      })

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
          userId,
          type: "folder.locked",
          title: "Folder locked",
          message: `${updated.name} is now password protected.`,
          entityType: "folder",
          entityId: updated.id,
        })
      }

      reply.send({
        data: serializeFolder(updated, 0, {
          isLocked: true,
          accessGranted: folderAccessGranted(request, userId, updated, request.auth?.session ?? null),
        }),
      })
    },
  )

  fastify.post(
    "/folders/:folderId/unlock",
    { preHandler: folderLockAuth },
    async (request, reply) => {
      const params = z.object({ folderId: z.string() }).parse(request.params)
      const parsed = folderCredentialSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Password or PIN required." },
        })
        return
      }

      const existing = await fastify.prisma.folder.findUnique({
        where: { id: params.folderId },
      })
      if (!existing || existing.deletedAt) {
        reply.status(404).send({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { aiConfig: true },
      })
      const userId = request.auth!.user.id
      const verified = await verifyFolderAccessCredential(
        fastify,
        userId,
        parsed.data,
        instance?.aiConfig,
      )
      if (!verified.ok) {
        reply.status(401).send({
          error: {
            code: verified.code,
            message:
              verified.code === "INVALID_PIN"
                ? "Incorrect vault PIN."
                : "Incorrect account password.",
          },
        })
        return
      }

      await grantFolderSessionAccess(fastify, request, reply, userId, existing.id)

      reply.send({
        data: serializeFolder(existing, 0, {
          isLocked: folderIsLocked(existing),
          accessGranted: true,
        }),
      })
    },
  )

  fastify.post(
    "/folders/:folderId/remove-lock",
    { preHandler: folderLockAuth },
    async (request, reply) => {
      const params = z.object({ folderId: z.string() }).parse(request.params)
      const parsed = folderCredentialSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Password or PIN required." },
        })
        return
      }

      const existing = await fastify.prisma.folder.findUnique({
        where: { id: params.folderId },
      })
      if (!existing || existing.deletedAt) {
        reply.status(404).send({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { aiConfig: true },
      })
      const userId = request.auth!.user.id
      const verified = await verifyFolderAccessCredential(
        fastify,
        userId,
        parsed.data,
        instance?.aiConfig,
      )
      if (!verified.ok) {
        reply.status(401).send({
          error: {
            code: verified.code,
            message:
              verified.code === "INVALID_PIN"
                ? "Incorrect vault PIN."
                : "Incorrect account password.",
          },
        })
        return
      }

      const updated = await fastify.prisma.folder.update({
        where: { id: existing.id },
        data: {
          lockedAt: null,
          lockedByUserId: null,
        },
      })

      reply.send({
        data: serializeFolder(updated, 0, { isLocked: false, accessGranted: true }),
      })
    },
  )
}
