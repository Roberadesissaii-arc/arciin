import type { FastifyError, FastifyInstance } from "fastify"

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

function asFastifyError(err: unknown): FastifyError {
  if (err !== null && typeof err === "object") {
    return err as FastifyError
  }
  const wrapper = new Error(String(err)) as FastifyError
  return wrapper
}

/**
 * A Prisma error, recognised without importing the client here.
 *
 * Every known-request error carries a `P####` code and the client version.
 * Checking the shape keeps this plugin free of a runtime dependency on the ORM
 * while still catching the errors that must never reach a caller verbatim.
 */
function isPrismaError(error: FastifyError): boolean {
  const e = error as unknown as { code?: unknown; clientVersion?: unknown }
  return typeof e.code === "string" && /^P\d{4}$/.test(e.code) && "clientVersion" in e
}

/**
 * What a database failure means to the caller.
 *
 * A duplicate folder name used to answer 500 with the raw Prisma invocation —
 * the failing call, the surrounding source lines with their variable names, and
 * the exact constraint `(libraryId, pathCache)`. That is a schema map handed to
 * anyone who can trip a constraint, and the status was wrong too: a name that is
 * already taken is a conflict the caller can fix, not a server fault.
 *
 * The mapped message says what happened in the caller's terms. The original
 * error still reaches the server log, where diagnosing it belongs.
 */
function mapDatabaseError(code: string): { status: number; code: string; message: string } {
  switch (code) {
    case "P2002":
      return {
        status: 409,
        code: "ALREADY_EXISTS",
        message: "Something with that name already exists here.",
      }
    case "P2025":
      return { status: 404, code: "NOT_FOUND", message: "That item no longer exists." }
    case "P2003":
      return {
        status: 409,
        code: "IN_USE",
        message: "That item is still referenced by something else.",
      }
    case "P2000":
      return { status: 400, code: "VALUE_TOO_LONG", message: "One of the values is too long." }
    default:
      return {
        status: 500,
        code: "DATABASE_ERROR",
        message: "An unexpected error occurred.",
      }
  }
}

export async function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((rawError, request, reply) => {
    const error = asFastifyError(rawError)

    /**
     * A refused cross-origin request is a refusal, not a crash.
     *
     * @fastify/cors rejects by calling back with a bare Error, which has no
     * statusCode — so it fell through as 500 SERVER_ERROR. The request was
     * correctly blocked, but the status told the caller (and our own logs)
     * that the server had broken.
     */
    if (error.message === "Origin not allowed") {
      fastify.log.warn(
        { origin: request.headers.origin, url: request.url },
        "Blocked a cross-origin request",
      )
      reply.status(403).send({
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This origin is not allowed." },
      })
      return
    }

    if (isPrismaError(error)) {
      const prismaCode = (error as unknown as { code: string }).code
      const mapped = mapDatabaseError(prismaCode)

      // Full detail server-side, keyed to the request, and nowhere else.
      fastify.log.error(
        { err: rawError, prismaCode, reqId: request.id, url: request.url },
        "Database error",
      )

      reply.status(mapped.status).send({
        error: { code: mapped.code, message: mapped.message, requestId: request.id },
      })
      return
    }

    const status = error.statusCode ?? 500

    if (status >= 500) {
      fastify.log.error({ err: rawError, reqId: request.id }, "Unhandled server error")
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
          ...(status >= 500 ? { requestId: request.id } : {}),
        },
      }),
    )
  })
}
