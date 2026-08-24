import type { FastifyInstance } from "fastify"
import { z } from "zod"


import { apiConfig } from "@/config"
import { requireSessionRole } from "@/services/security/auth"
import {
  getLogsDisplayPath,
  getLogsDirectory,
  listLogFiles,
  tailLogFile,
} from "@/services/logs/log-files"
import { assertStorageWritable } from "@/services/storage/local-storage"
import { serializeJob } from "@/services/serializers"

async function collectHealth(fastify: FastifyInstance) {
  let database: "online" | "offline" = "online"
  let redis: "online" | "offline" = "online"
  let realtime: "online" | "offline" = "online"
  let storage: "online" | "offline" = "online"
  let worker: "online" | "offline" | "unknown" = "unknown"
  let workerLastSeenAt: string | null = null

  try {
    await fastify.prisma.$queryRaw`SELECT 1`
  } catch {
    database = "offline"
  }

  try {
    await fastify.redis.ping()
    realtime = "online"
    const heartbeat = await fastify.redis.get(apiConfig.workerHeartbeatKey)
    if (heartbeat) {
      const seenMs = Number(heartbeat)
      workerLastSeenAt = new Date(seenMs).toISOString()
      worker = Date.now() - seenMs < 60_000 ? "online" : "offline"
    }
  } catch {
    redis = "offline"
    realtime = "offline"
    worker = "offline"
  }

  const storageWritable = await assertStorageWritable(apiConfig.dataDir)
  if (!storageWritable) {
    storage = "offline"
  }

  return {
    api: "online" as const,
    database,
    redis,
    realtime,
    worker,
    storage,
    version: apiConfig.appVersion,
    timestamp: new Date().toISOString(),
    workerLastSeenAt,
  }
}

export async function registerLogsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/logs/overview",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (_request, reply) => {
      const health = await collectHealth(fastify)

      let files: Awaited<ReturnType<typeof listLogFiles>> = []
      let logsReadable = true
      try {
        files = await listLogFiles()
      } catch {
        logsReadable = false
      }

      const [queued, active, completed, failed, recentFailed] = await Promise.all([
        fastify.prisma.job.count({ where: { status: "QUEUED" } }),
        fastify.prisma.job.count({ where: { status: "ACTIVE" } }),
        fastify.prisma.job.count({ where: { status: "COMPLETED" } }),
        fastify.prisma.job.count({ where: { status: "FAILED" } }),
        fastify.prisma.job.findMany({
          where: { status: "FAILED" },
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
      ])

      reply.send({
        data: {
          health,
          logs: {
            displayPath: getLogsDisplayPath(),
            readable: logsReadable,
            writable: await assertStorageWritable(getLogsDirectory()),
            fileCount: files.length,
            totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
          },
          jobs: {
            queued,
            active,
            completed,
            failed,
            recentFailed: recentFailed.map(serializeJob),
          },
          environment: apiConfig.NODE_ENV,
        },
      })
    },
  )

  fastify.get(
    "/logs/files",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (_request, reply) => {
      try {
        const files = await listLogFiles()
        reply.send({ data: files })
      } catch {
        reply.status(503).send({
          error: {
            code: "LOGS_UNAVAILABLE",
            message: "Log directory is not readable.",
          },
        })
      }
    },
  )

  fastify.get<{ Params: { filename: string }; Querystring: { lines?: string } }>(
    "/logs/files/:filename/tail",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const params = z.object({ filename: z.string() }).parse(request.params)
      const lines = Math.min(
        500,
        Math.max(1, parseInt(request.query.lines ?? "200", 10) || 200),
      )

      try {
        const tail = await tailLogFile(params.filename, lines)
        reply.send({
          data: {
            filename: params.filename,
            lines: tail,
          },
        })
      } catch (error) {
        const code = error instanceof Error ? error.message : "UNKNOWN"
        if (code === "INVALID_LOG_FILE" || code === "LOG_FILE_NOT_FOUND") {
          reply.status(404).send({
            error: { code: "LOG_FILE_NOT_FOUND", message: "Log file not found." },
          })
          return
        }
        if (code === "LOG_FILE_TOO_LARGE") {
          reply.status(413).send({
            error: {
              code: "LOG_FILE_TOO_LARGE",
              message: "Log file is too large to stream. Open it on the server directly.",
            },
          })
          return
        }
        reply.status(503).send({
          error: { code: "LOGS_UNAVAILABLE", message: "Could not read log file." },
        })
      }
    },
  )
}
