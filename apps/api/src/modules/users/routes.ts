import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  createManagedUser,
  deleteManagedUser,
  listUsers,
  updateManagedUser,
  UserAdminError,
} from "@/services/user/admin-users"
import { requireFeature, requireSessionRole } from "@/services/security/auth"

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(256),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
})

const patchUserSchema = z
  .object({
    role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "Provide role and/or status.",
  })

function sendAdminError(reply: import("fastify").FastifyReply, error: UserAdminError) {
  reply.status(error.statusCode).send({
    error: { code: error.code, message: error.message },
  })
}

export async function registerUserAdminRoutes(fastify: FastifyInstance) {
  const gate = [requireSessionRole(["OWNER", "ADMIN"]), requireFeature("team.multi_user")]

  fastify.get("/settings/users", { preHandler: gate }, async (request, reply) => {
    const data = await listUsers(fastify.prisma)
    reply.send({ data })
  })

  fastify.post("/settings/users", { preHandler: gate }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid user payload.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const data = await createManagedUser(fastify.prisma, request.auth!.user, parsed.data)
      reply.status(201).send({ data })
    } catch (error) {
      if (error instanceof UserAdminError) {
        sendAdminError(reply, error)
        return
      }
      throw error
    }
  })

  fastify.patch("/settings/users/:userId", { preHandler: gate }, async (request, reply) => {
    const parsed = patchUserSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid update payload.", details: parsed.error.flatten() },
      })
      return
    }
    const { userId } = request.params as { userId: string }
    try {
      const data = await updateManagedUser(fastify.prisma, request.auth!.user, userId, parsed.data)
      reply.send({ data })
    } catch (error) {
      if (error instanceof UserAdminError) {
        sendAdminError(reply, error)
        return
      }
      throw error
    }
  })

  fastify.delete("/settings/users/:userId", { preHandler: gate }, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    try {
      await deleteManagedUser(fastify.prisma, request.auth!.user, userId)
      reply.status(204).send()
    } catch (error) {
      if (error instanceof UserAdminError) {
        sendAdminError(reply, error)
        return
      }
      throw error
    }
  })
}
