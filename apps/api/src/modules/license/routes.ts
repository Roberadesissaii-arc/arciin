import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { isLicensePlanId, LICENSE_PLANS, publicLicenseView } from "@arciin/shared"

import {
  activateLicense,
  deactivateLicense,
  refreshLicense,
  syncLicenseStatusIfNeeded,
} from "@/services/license/license-service"
import {
  hostedCreateDemo,
  hostedStatus,
  licenseServerBaseUrl,
} from "@/services/license/hosted-client"
import { requireRole } from "@/services/security/auth"

const activateSchema = z.object({
  licenseKey: z.string().min(4).max(200),
  /** Optional paid term length for mock keys (default 30). */
  durationDays: z.number().int().min(1).max(3650).optional(),
})

const demoSchema = z.object({
  plan: z.enum(LICENSE_PLANS),
  customerName: z.string().min(1).max(200).optional(),
  customerEmail: z.string().email().max(320).optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  serverLimit: z.number().int().min(1).max(999).optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
})

export async function registerLicenseRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/license/status",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (_request, reply) => {
      // Prefer live re-check (hosted revoke / expiry) so clients never flash a
      // stale Pro plan from the local row alone. Offline keeps signed token grace.
      let snapshot = await refreshLicense(fastify.prisma)
      snapshot = await syncLicenseStatusIfNeeded(fastify.prisma, snapshot)
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
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
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
          },
        })
        return
      }

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
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const snapshot = await refreshLicense(fastify.prisma)
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
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const snapshot = await deactivateLicense(fastify.prisma)
      reply.send({
        data: {
          ...publicLicenseView(snapshot),
          licenseServerConfigured: Boolean(licenseServerBaseUrl()),
        },
      })
    },
  )

  /**
   * Create a demo/manual license on the hosted license server (no Stripe).
   * Proxied so the browser never talks to the license server directly.
   */
  fastify.post(
    "/license/demo",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (!licenseServerBaseUrl()) {
        reply.status(503).send({
          error: {
            code: "LICENSE_SERVER_NOT_CONFIGURED",
            message:
              "Hosted license server is not configured. Set ARCIIN_LICENSE_SERVER_URL and start apps/license-server.",
          },
        })
        return
      }

      const parsed = demoSchema.safeParse(request.body)
      if (!parsed.success || !isLicensePlanId(parsed.data.plan)) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide a valid plan.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const remote = await hostedCreateDemo(parsed.data)
      if (!remote.ok) {
        reply.status(remote.status >= 400 ? remote.status : 502).send({
          error: { code: remote.code, message: remote.message },
        })
        return
      }

      reply.status(201).send({ data: remote.data })
    },
  )

  /** Optional: fetch activation list for a key from the hosted server (demo portal). */
  fastify.get(
    "/license/hosted-status",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (!licenseServerBaseUrl()) {
        reply.status(503).send({
          error: {
            code: "LICENSE_SERVER_NOT_CONFIGURED",
            message: "Hosted license server is not configured.",
          },
        })
        return
      }

      const q = request.query as { licenseKey?: string; licenseId?: string; activationId?: string }
      if (!q.licenseKey && !q.licenseId && !q.activationId) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide licenseKey, licenseId, or activationId.",
          },
        })
        return
      }

      const remote = await hostedStatus({
        licenseKey: q.licenseKey,
        licenseId: q.licenseId,
        activationId: q.activationId,
      })
      if (!remote.ok) {
        reply.status(remote.status >= 400 ? remote.status : 502).send({
          error: { code: remote.code, message: remote.message },
        })
        return
      }
      reply.send({ data: remote.data })
    },
  )
}
