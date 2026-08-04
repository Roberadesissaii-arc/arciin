import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  countVisibleAssetsByLibrary,
  countVisibleAssetsForLibrary,
} from "@/services/libraries/visible-assets"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeLibrary } from "@/services/serializers"
import { slugify } from "@/services/slug"

const librarySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  kind: z.enum(["VIDEO", "IMAGE", "AUDIO", "DOCUMENT", "INBOX", "CUSTOM"]).default("CUSTOM"),
})

export async function registerLibraryRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/libraries",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["libraries:read"],
      ),
    },
    async (_request, reply) => {
      const libraries = await fastify.prisma.library.findMany({
        include: {
          _count: {
            select: {
              folders: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 100,
      })

      // Counted with the same rules the library page lists by, so the sidebar
      // number always matches what opening the library shows.
      const visibleCounts = await countVisibleAssetsByLibrary(fastify.prisma)

      reply.send({
        data: libraries.map((library) =>
          serializeLibrary(library, visibleCounts.get(library.id) ?? 0),
        ),
      })
    }
  )

  /** Top-level libraries are fixed at instance setup (Videos, Images, Music, Documents, Inbox). Organize with folders instead. */
  fastify.post(
    "/libraries",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(["OWNER", "ADMIN"], ["libraries:write"]),
    },
    async (_request, reply) => {
      reply.status(403).send({
        error: {
          code: "LIBRARY_CREATION_DISABLED",
          message:
            "Libraries are fixed for this instance. You cannot create new top-level libraries. Create folders inside a library (POST /libraries/:libraryId/folders) or upload with librarySlug (see POST /uploads).",
          details: {},
        },
      })
    },
  )

  fastify.get(
    "/libraries/:libraryId",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["libraries:read"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ libraryId: z.string() }).parse(request.params)
      const library = await fastify.prisma.library.findUnique({
        where: {
          id: params.libraryId,
        },
        include: {
          _count: {
            select: {
              folders: { where: { deletedAt: null } },
            },
          },
        },
      })

      if (!library) {
        reply.status(404).send({
          error: {
            code: "LIBRARY_NOT_FOUND",
            message: "Library not found.",
          },
        })
        return
      }

      reply.send({
        data: serializeLibrary(
          library,
          await countVisibleAssetsForLibrary(fastify.prisma, library.id),
        ),
      })
    }
  )

  fastify.patch(
    "/libraries/:libraryId",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(["OWNER", "ADMIN"], ["libraries:write"]),
    },
    async (request, reply) => {
      const params = z.object({ libraryId: z.string() }).parse(request.params)
      const parsed = librarySchema.partial().safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid library payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const library = await fastify.prisma.library.update({
        where: {
          id: params.libraryId,
        },
        data: {
          ...parsed.data,
          slug: parsed.data.name ? slugify(parsed.data.name) : undefined,
        },
        include: {
          _count: {
            select: {
              folders: { where: { deletedAt: null } },
            },
          },
        },
      })

      reply.send({
        data: serializeLibrary(
          library,
          await countVisibleAssetsForLibrary(fastify.prisma, library.id),
        ),
      })
    }
  )

  fastify.delete(
    "/libraries/:libraryId",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(["OWNER", "ADMIN"], ["libraries:write"]),
    },
    async (request, reply) => {
      const params = z.object({ libraryId: z.string() }).parse(request.params)
      const library = await fastify.prisma.library.findUnique({
        where: {
          id: params.libraryId,
        },
        include: {
          // Deletion guards on *every* remaining asset and folder, not just the
          // visible ones — a hidden or deleted-folder asset still blocks it.
          _count: {
            select: {
              assets: { where: { deletedAt: null } },
              folders: true,
            },
          },
        },
      })

      if (!library) {
        reply.status(404).send({
          error: {
            code: "LIBRARY_NOT_FOUND",
            message: "Library not found.",
          },
        })
        return
      }

      if (library.kind !== "CUSTOM") {
        reply.status(409).send({
          error: {
            code: "DEFAULT_LIBRARY_PROTECTED",
            message: "Default libraries cannot be deleted.",
          },
        })
        return
      }

      if (library._count.assets || library._count.folders) {
        reply.status(409).send({
          error: {
            code: "LIBRARY_NOT_EMPTY",
            message: "Remove folders and assets before deleting this library.",
          },
        })
        return
      }

      await fastify.prisma.library.delete({
        where: {
          id: params.libraryId,
        },
      })

      reply.send({
        data: {
          success: true,
        },
      })
    }
  )
}
