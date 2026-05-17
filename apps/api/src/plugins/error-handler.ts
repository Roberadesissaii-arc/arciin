import type { FastifyInstance } from "fastify"

import { apiConfig } from "@/config"

const PATH_PATTERN = /\/[^\s"']+\/(arciin|data|objects|thumbnails|temp|libraries)\S*/gi

/** Replace absolute filesystem paths in strings with a safe placeholder. */
function sanitizePaths(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(PATH_PATTERN, "[path redacted]")
  }
  if (Array.isArray(value)) {
    return value.map(sanitizePaths)
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizePaths(v)]),
    )
  }
  return value
}

export async function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode ?? 500

    if (status >= 500) {
      fastify.log.error({ err: error }, "Unhandled server error")
    }

    const message =
      apiConfig.isProduction && status >= 500
        ? "An unexpected error occurred."
        : (error.message ?? "An unexpected error occurred.")

    reply.status(status).send(
      sanitizePaths({
        error: {
          code: error.code ?? "SERVER_ERROR",
          message,
        },
      }),
    )
  })
}
