import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { apiConfig } from "@/config"
import { serializeAuth } from "@/services/serializers"
import {
  authenticate,
  clearSessionCookie,
  createSession,
  hashToken,
  setSessionCookie,
  verifyPassword,
} from "@/services/security/auth"

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/auth/me",
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      if (!request.auth) {
        return
      }

      reply.send({
        data: serializeAuth(request.auth.user, request.auth.session),
      })
    }
  )

  fastify.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)

    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid login payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const user = await fastify.prisma.user.findUnique({
      where: {
        email: parsed.data.email.toLowerCase(),
      },
    })

    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      reply.status(401).send({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect.",
        },
      })
      return
    }

    const { session, rawToken } = await createSession(request, user.id)
    setSessionCookie(reply, rawToken, session.expiresAt)

    await fastify.prisma.activityEvent.create({
      data: {
        userId: user.id,
        type: "auth.login",
        title: "Signed in",
        message: `${user.name} signed in.`,
      },
    })

    reply.send({
      data: serializeAuth(user, session),
    })
  })

  fastify.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[apiConfig.SESSION_COOKIE_NAME]

    if (token) {
      await fastify.prisma.session.deleteMany({
        where: {
          tokenHash: hashToken(token),
        },
      })
    }

    clearSessionCookie(reply)

    reply.send({
      data: {
        success: true,
      },
    })
  })
}
