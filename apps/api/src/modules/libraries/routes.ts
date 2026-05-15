import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { authenticate, requireRole } from "@/services/security/auth"
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
      preHandler: authenticate,
    },
    async (_request, reply) => {
      const libraries = await fastify.prisma.library.findMany({
        include: {
          _count: {
            select: {
              assets: { where: { deletedAt: null } },
              folders: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      })

      reply.send({
        data: libraries.map(serializeLibrary),
      })
    }
  )

  fastify.post(
    "/libraries",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const parsed = librarySchema.safeParse(request.body)

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

      const storageLocation = await fastify.prisma.storageLocation.findFirst({
        where: {
          isDefault: true,
        },
      })

      if (!storageLocation) {
        reply.status(409).send({
          error: {
            code: "STORAGE_NOT_CONFIGURED",
            message: "A default storage location is required before creating libraries.",
          },
        })
        return
      }

      const library = await fastify.prisma.library.create({
        data: {
          name: parsed.data.name,
          slug: slugify(parsed.data.name),
          description: parsed.data.description,
          kind: parsed.data.kind,
          storageLocationId: storageLocation.id,
        },
        include: {
          _count: {
            select: {
              assets: { where: { deletedAt: null } },
              folders: true,
            },
          },
        },
      })

      if (request.auth) {
        await fastify.publishRealtimeEvent(
          buildRealtimeEvent("library.created", {
            userId: request.auth.user.id,
            libraryId: library.id,
            message: `Library "${library.name}" created.`,
          })
        )
      }

      reply.status(201).send({
        data: serializeLibrary(library),
      })
    }
  )

  fastify.get(
    "/libraries/:libraryId",
    {
      preHandler: authenticate,
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

      reply.send({
        data: serializeLibrary(library),
      })
    }
  )

  fastify.patch(
    "/libraries/:libraryId",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
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
              assets: { where: { deletedAt: null } },
              folders: true,
            },
          },
        },
      })

      reply.send({
        data: serializeLibrary(library),
      })
    }
  )

  fastify.delete(
    "/libraries/:libraryId",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
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
