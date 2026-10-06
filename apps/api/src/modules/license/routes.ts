import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { publicLicenseView } from "@arciin/shared"

import {
  activateLicense,
  deactivateLicense,
  refreshLicense,
  syncLicenseStatusIfNeeded,
} from "@/services/license/license-service"
import { licenseServerBaseUrl } from "@/services/license/hosted-client"
import { reconcilePublicRemoteAccess } from "@/services/remote-access/tunnel-boot"
import { requireSessionRole } from "@/services/security/auth"

const activateSchema = z.object({
  licenseKey: z.string().min(4).max(200),
  /** Optional paid term length for mock keys (default 30). */
  durationDays: z.number().int().min(1).max(3650).optional(),
})

/**
 * There is deliberately no license-creation route here.
 *
 * This API used to proxy `POST /licenses/demo` to the licensing authority, so
 * any instance OWNER could ask the vendor's server to mint them a Business
 * license — no order, no payment. A shipped product must contain no path that
 * says "give me an entitlement"; licenses are issued by arciin-web against a
 * paid order and arrive as a key the customer pastes in.
 */

export async function registerLicenseRoutes(fastify: FastifyInstance) {
  /**
   * After anything that can change the plan, bring public Remote Access in line
   * before answering — a downgrade stops Arciin's quick tunnel here rather than
   * at the next restart. Never fails the license request itself.
   */
  const settleRemoteAccess = (reason: string) =>
    reconcilePublicRemoteAccess(fastify, reason).catch((err) =>
      fastify.log.warn({ err: err instanceof Error ? err.message : String(err), reason }, "Remote Access entitlement reconcile failed"),
    )

  fastify.get(
    "/license/status",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (_request, reply) => {
      // Prefer live re-check (hosted revoke / expiry) so clients never flash a
      // stale Pro plan from the local row alone. Offline keeps signed token grace.
      let snapshot = await refreshLicense(fastify.prisma)
      snapshot = await syncLicenseStatusIfNeeded(fastify.prisma, snapshot)
      await settleRemoteAccess("license-status")
      const view = publicLicenseView(snapshot)
      reply.send({
        data: {
          ...view,
          licenseServerConfigured: Boolean(licenseServerBaseUrl()),
          licenseServerUrl: licenseServerBaseUrl(),
        },
      })
    },
  )

  fastify.post(
    "/license/activate",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = activateSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide a license key.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const result = await activateLicense(fastify.prisma, parsed.data.licenseKey, {
        durationDays: parsed.data.durationDays,
      })

      if (!result.ok) {
        reply.status(400).send({
          error: {
            code: result.code,
            message: result.message,
            ...(result.details ? { details: result.details } : {}),
          },
        })
        return
      }

      await settleRemoteAccess("license-activate")
      reply.send({
        data: {
          ...publicLicenseView(result.snapshot),
          licenseServerConfigured: Boolean(licenseServerBaseUrl()),
        },
      })
    },
  )

  fastify.post(
    "/license/refresh",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const snapshot = await refreshLicense(fastify.prisma)
      await settleRemoteAccess("license-refresh")
      reply.send({
        data: {
          ...publicLicenseView(snapshot),
          licenseServerConfigured: Boolean(licenseServerBaseUrl()),
        },
      })
    },
  )

  fastify.post(
    "/license/deactivate",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const snapshot = await deactivateLicense(fastify.prisma)
      await settleRemoteAccess("license-deactivate")
      reply.send({
        data: {
          ...publicLicenseView(snapshot),
          licenseServerConfigured: Boolean(licenseServerBaseUrl()),
        },
      })
    },
  )

}
