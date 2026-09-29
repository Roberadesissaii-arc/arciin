import path from "node:path"
import { randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"

import { normalizeConfiguredStorageRoot } from "@arciin/storage"

import { apiConfig } from "@/config"
import { requireSessionRole } from "@/services/security/auth"
import { auditStorage, storageAuditRoots, type StorageAudit } from "@/services/storage/storage-audit"

/**
 * Read-only storage audit, owner/admin only.
 *
 * Walking a storage root and a backup tree can take a while on a busy disk, so
 * a request never waits for it: POST starts one (or returns the one already
 * running), and GET reads its state. Every directory it looks at comes from
 * server configuration; nothing in a request names a path. There is no delete
 * route, here or anywhere the audit's numbers are shown.
 */

type AuditRun = {
  id: string
  status: "running" | "done" | "failed"
  startedAt: string
  finishedAt: string | null
  result: StorageAudit | null
  error: string | null
}

const KEEP = 5
const runs: AuditRun[] = []

export async function registerStorageAuditRoutes(fastify: FastifyInstance) {
  const admin = { preHandler: requireSessionRole(["OWNER", "ADMIN"]) }

  fastify.post("/admin/storage-audit", admin, async (_request, reply) => {
    const running = runs.find((r) => r.status === "running")
    if (running) {
      reply.status(202).send({ data: running })
      return
    }
    const instance = await fastify.prisma.instanceConfig.findFirst({ select: { storageRoot: true } })
    const storageRoot = normalizeConfiguredStorageRoot(instance?.storageRoot, path.resolve(apiConfig.dataDir))
    const run: AuditRun = {
      id: randomUUID(),
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    }
    runs.unshift(run)
    runs.splice(KEEP)
    void auditStorage({ prisma: fastify.prisma, ...storageAuditRoots(storageRoot) })
      .then((result) => {
        run.status = "done"
        run.result = result
      })
      .catch((error: unknown) => {
        run.status = "failed"
        // A code-like message only; never a path or stack.
        run.error = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "AUDIT_FAILED"
        fastify.log.warn({ code: run.error }, "storage audit failed")
      })
      .finally(() => {
        run.finishedAt = new Date().toISOString()
      })
    reply.status(202).send({ data: run })
  })

  fastify.get("/admin/storage-audit/latest", admin, async (_request, reply) => {
    reply.header("Cache-Control", "no-store")
    reply.send({ data: runs[0] ?? null })
  })

  fastify.get<{ Params: { id: string } }>("/admin/storage-audit/:id", admin, async (request, reply) => {
    reply.header("Cache-Control", "no-store")
    const run = runs.find((r) => r.id === request.params.id)
    if (!run) {
      reply.status(404).send({ error: { code: "NOT_FOUND", message: "No such audit." } })
      return
    }
    reply.send({ data: run })
  })
}

/** Test hook: forget past runs. */
export function resetStorageAuditRuns() {
  runs.splice(0)
}
