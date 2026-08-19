import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireFeature, requireRole } from "@/services/security/auth"
import { serializeJob } from "@/services/serializers"

export async function registerJobRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/jobs",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (_request, reply) => {
      const jobs = await fastify.prisma.job.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      })

      reply.send({
        data: jobs.map(serializeJob),
      })
    }
  )

  /**
   * Clearing the queue is a job *control*, which Pro sells. Reading jobs stays
   * free — the pricing page promises Free "basic logs, jobs, events & activity",
   * and locking someone out of seeing their own queue would break that.
   */
  fastify.delete(
    "/jobs",
    { preHandler: [requireRole(["OWNER", "ADMIN"]), requireFeature("ops.job_controls")] },
    async (_request, reply) => {
      const { count } = await fastify.prisma.job.deleteMany({
        where: { status: { in: ["COMPLETED", "FAILED"] } },
      })
      reply.send({ data: { cleared: count } })
    }
  )

  fastify.get(
    "/jobs/:jobId",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (request, reply) => {
      const params = z.object({ jobId: z.string() }).parse(request.params)
      const job = await fastify.prisma.job.findUnique({
        where: {
          id: params.jobId,
        },
      })

      if (!job) {
        reply.status(404).send({
          error: {
            code: "JOB_NOT_FOUND",
            message: "Job not found.",
          },
        })
        return
      }

      reply.send({
        data: serializeJob(job),
      })
    }
  )
}
