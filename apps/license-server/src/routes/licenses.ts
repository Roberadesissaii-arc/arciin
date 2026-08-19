import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { isLicensePlanId, LICENSE_PLANS } from "@arciin/config"

import { licenseServerConfig } from "../config.js"
import { checkRateLimit, requireAdminAuth, requireServiceAuth } from "../security.js"
import {
  activateLicense,
  createDemoLicense,
  deactivateByLicenseId,
  deactivateLicense,
  findLicenseByOrder,
  getAccountOverview,
  getInstanceLicenseStatus,
  getLicenseStatus,
  issueLicense,
  refreshLicense,
  revokeLicense,
  revokeLicenseById,
  deleteLicenseById,
} from "../services/license-ops.js"

const planSchema = z.enum(LICENSE_PLANS)

/**
 * Per-IP budgets.
 *
 * Instance-facing routes are used by real servers checking in, so the limits
 * have to clear normal operation comfortably — a locked-out paying customer is
 * a worse outcome than a slow brute force.
 *
 * Activation is the one route that takes a secret, but that secret is 128 bits
 * of CSPRNG: guessing is not the threat these numbers address, volume abuse is.
 * They are set high enough that a whole office or hosting tenancy behind one
 * egress IP can activate their fleet without tripping — a NAT gateway looks
 * exactly like an attacker to a per-IP counter, and the wrong call there locks
 * out paying customers.
 */
const RATE_LIMITS = {
  activate: { key: "activate", limit: 30, windowSec: 60 },
  refresh: { key: "refresh", limit: 60, windowSec: 60 },
  deactivate: { key: "deactivate", limit: 20, windowSec: 60 },
  status: { key: "status", limit: 30, windowSec: 60 },
  service: { key: "service", limit: 120, windowSec: 60 },
} as const

export async function registerLicenseRoutes(app: FastifyInstance) {
  /**
   * Browser root. Deliberately says nothing about the API surface — the old
   * banner listed every endpoint and pointed at the account portal, which is
   * free reconnaissance for anyone who finds the port.
   */
  app.get("/", async (request, reply) => {
    const accept = String(request.headers.accept ?? "")
    if (accept.includes("text/html")) {
      reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arciin</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center;
           font-family: system-ui, sans-serif; background:#09090b; color:#a1a1aa; }
  </style>
</head>
<body><p>Arciin licensing service.</p></body>
</html>`)
      return
    }
    reply.send({ service: "arciin-license-server", status: "ok" })
  })

  app.get("/health", async (_req, reply) => {
    reply.send({ ok: true, service: "arciin-license-server" })
  })

  /* ---------------------------------------------------------------- */
  /* Instance-facing — public, rate limited, no service credential      */
  /* ---------------------------------------------------------------- */

  app.post("/licenses/activate", async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.activate)) return

    const body = z
      .object({
        licenseKey: z.string().min(4).max(200),
        instanceId: z.string().min(1).max(128),
        instanceName: z.string().max(200).optional(),
        version: z.string().max(64).optional(),
        hostname: z.string().max(255).optional(),
      })
      .safeParse(request.body)

    if (!body.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "licenseKey and instanceId are required.",
          details: body.error.flatten(),
        },
      })
      return
    }

    const result = await activateLicense(body.data)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  app.post("/licenses/refresh", async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.refresh)) return

    const body = z
      .object({
        token: z.string().min(10).optional(),
        licenseKey: z.string().min(4).max(200).optional(),
        instanceId: z.string().min(1).max(128).optional(),
      })
      .safeParse(request.body)

    if (!body.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid refresh payload." },
      })
      return
    }

    const result = await refreshLicense(body.data)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  app.post("/licenses/deactivate", async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.deactivate)) return

    const body = z
      .object({
        licenseKey: z.string().min(4).max(200).optional(),
        token: z.string().min(10).optional(),
        instanceId: z.string().min(1).max(128),
      })
      .safeParse(request.body)

    if (!body.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "instanceId plus licenseKey or token is required.",
        },
      })
      return
    }

    const result = await deactivateLicense(body.data)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  /**
   * Instance status. Requires the key *and* the instance id, and answers only
   * about that instance — no customer identity, no other activations.
   */
  app.get("/licenses/status", async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.status)) return

    const q = request.query as Record<string, string | undefined>
    const parsed = z
      .object({
        licenseKey: z.string().min(4).max(200),
        instanceId: z.string().min(1).max(128),
      })
      .safeParse(q)

    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "licenseKey and instanceId are required.",
        },
      })
      return
    }

    const result = await getInstanceLicenseStatus(parsed.data)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  /* ---------------------------------------------------------------- */
  /* Service-facing — vendor backends only (arciin-web)                 */
  /* ---------------------------------------------------------------- */

  /**
   * Issue a purchased license.
   *
   * The caller supplies who and what plan; everything that decides entitlement
   * — server limit, features, grace — is derived here from the plan definition.
   * `externalOrderId` makes the call idempotent at the database level.
   */
  app.post("/licenses/issue", { preHandler: requireServiceAuth }, async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.service)) return

    const body = z
      .object({
        externalOrderId: z.string().min(1).max(128),
        plan: planSchema,
        billingInterval: z.enum(["monthly", "yearly"]),
        customerEmail: z.string().email().max(320),
        customerName: z.string().min(1).max(200),
      })
      .safeParse(request.body)

    if (!body.success || !isLicensePlanId(body.data.plan)) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide externalOrderId, plan, billingInterval, customerEmail, customerName.",
          details: body.success ? undefined : body.error.flatten(),
        },
      })
      return
    }

    const result = await issueLicense(body.data)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.status(result.data.created ? 201 : 200).send({ data: result.data })
  })

  app.get(
    "/licenses/by-order/:externalOrderId",
    { preHandler: requireServiceAuth },
    async (request, reply) => {
      if (checkRateLimit(request, reply, RATE_LIMITS.service)) return
      const params = request.params as { externalOrderId?: string }
      if (!params.externalOrderId) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "externalOrderId is required." },
        })
        return
      }
      const result = await findLicenseByOrder(params.externalOrderId)
      if (!result.ok) {
        reply.status(result.status).send({ error: { code: result.code, message: result.message } })
        return
      }
      reply.send({ data: result.data })
    },
  )

  /** Full vendor-side view, including customer identity. */
  app.get("/licenses/lookup", { preHandler: requireServiceAuth }, async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.service)) return
    const q = request.query as Record<string, string | undefined>
    const result = await getLicenseStatus({
      licenseKey: q.licenseKey,
      activationId: q.activationId,
      licenseId: q.licenseId,
    })
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  app.post("/licenses/revoke", { preHandler: requireServiceAuth }, async (request, reply) => {
    if (checkRateLimit(request, reply, RATE_LIMITS.service)) return
    const body = z
      .object({
        licenseKey: z.string().min(4).max(200).optional(),
        licenseId: z.string().min(1).max(64).optional(),
      })
      .safeParse(request.body)
    if (!body.success || (!body.data.licenseKey && !body.data.licenseId)) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "licenseKey or licenseId required." },
      })
      return
    }
    const result = body.data.licenseId
      ? await revokeLicenseById(body.data.licenseId)
      : await revokeLicense(body.data.licenseKey!)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  app.post(
    "/account/deactivate-server",
    { preHandler: requireServiceAuth },
    async (request, reply) => {
      if (checkRateLimit(request, reply, RATE_LIMITS.service)) return
      const body = z
        .object({ licenseId: z.string().min(1), instanceId: z.string().min(1) })
        .safeParse(request.body)
      if (!body.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "licenseId and instanceId required." },
        })
        return
      }
      const result = await deactivateByLicenseId(body.data)
      if (!result.ok) {
        reply.status(result.status).send({ error: { code: result.code, message: result.message } })
        return
      }
      reply.send({ data: result.data })
    },
  )

  /** Customer portal data. Service tier — the account prototype supplies the credential. */
  const accountOverview = async (
    request: { query: unknown },
    reply: {
      status: (c: number) => { send: (b: unknown) => void }
      send: (b: unknown) => void
    },
  ) => {
    const q = request.query as { email?: string }
    const result = await getAccountOverview({ email: q.email })
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return null
    }
    return result.data
  }

  app.get("/account/overview", { preHandler: requireServiceAuth }, async (request, reply) => {
    const data = await accountOverview(request, reply)
    if (data) reply.send({ data })
  })

  app.get("/account/licenses", { preHandler: requireServiceAuth }, async (request, reply) => {
    const data = await accountOverview(request, reply)
    if (data) reply.send({ data: { customer: data.customer, licenses: data.licenses } })
  })

  app.get("/account/activations", { preHandler: requireServiceAuth }, async (request, reply) => {
    const data = await accountOverview(request, reply)
    if (data) reply.send({ data: { customer: data.customer, activations: data.activations } })
  })

  /* ---------------------------------------------------------------- */
  /* Admin tier — destructive, and not reachable with a service token   */
  /* ---------------------------------------------------------------- */

  app.post("/licenses/delete", { preHandler: requireAdminAuth }, async (request, reply) => {
    const body = z.object({ licenseId: z.string().min(1).max(64) }).safeParse(request.body)
    if (!body.success) {
      reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "licenseId required." } })
      return
    }
    const result = await deleteLicenseById(body.data.licenseId)
    if (!result.ok) {
      reply.status(result.status).send({ error: { code: result.code, message: result.message } })
      return
    }
    reply.send({ data: result.data })
  })

  /**
   * Local prototype key generator.
   *
   * Admin tier *and* refused outright in production: a purchased license comes
   * from `/licenses/issue` against a real order, and there must be no path in a
   * production deployment that mints entitlement out of nothing.
   */
  app.post("/licenses/demo", { preHandler: requireAdminAuth }, async (request, reply) => {
    if (licenseServerConfig.isProduction) {
      reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Not found." },
      })
      return
    }

    const body = z
      .object({
        plan: planSchema,
        customerName: z.string().min(1).max(200).optional(),
        customerEmail: z.string().email().max(320).optional(),
        durationDays: z.number().int().min(1).max(3650).optional(),
        serverLimit: z.number().int().min(1).max(999).optional(),
        graceDays: z.number().int().min(0).max(90).optional(),
      })
      .safeParse(request.body)

    if (!body.success || !isLicensePlanId(body.data.plan)) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide a valid plan (free|pro|team|business).",
          details: body.success ? undefined : body.error.flatten(),
        },
      })
      return
    }

    const data = await createDemoLicense(body.data)
    reply.status(201).send({ data })
  })
}
