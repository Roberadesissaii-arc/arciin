import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { isLicensePlanId, LICENSE_PLANS } from "@arciin/config"

import { licenseServerConfig } from "../config.js"
import {
  activateLicense,
  createDemoLicense,
  deactivateByLicenseId,
  deactivateLicense,
  getAccountOverview,
  getLicenseStatus,
  refreshLicense,
  revokeLicense,
  revokeLicenseById,
} from "../services/license-ops.js"

const planSchema = z.enum(LICENSE_PLANS)

function unauthorized(reply: { status: (c: number) => { send: (b: unknown) => void } }, message: string) {
  reply.status(401).send({ error: { code: "UNAUTHORIZED", message } })
}

function checkDemoSecret(request: { headers: Record<string, unknown> }): boolean {
  const required = licenseServerConfig.LICENSE_DEMO_SECRET
  if (!required) return true
  const header = request.headers["x-arciin-demo-secret"]
  const value = typeof header === "string" ? header : Array.isArray(header) ? header[0] : ""
  return value === required
}

export async function registerLicenseRoutes(app: FastifyInstance) {
  /**
   * Browser root — this service is an API only (no account UI).
   * Customers use account.arciin.com (prototype: :3010). Instances call /licenses/*.
   */
  app.get("/", async (_req, reply) => {
    const accept = String(_req.headers.accept ?? "")
    const payload = {
      service: "arciin-license-server",
      status: "ok",
      message:
        "This is the hosted license API (future license.arciin.com). There is no customer UI on this port.",
      accountPortal: "http://localhost:3010/account",
      health: "/health",
      endpoints: [
        "POST /licenses/demo",
        "POST /licenses/activate",
        "POST /licenses/refresh",
        "POST /licenses/deactivate",
        "GET /licenses/status",
        "GET /account/overview",
      ],
      hint: "Open the account portal (pnpm account) for licenses UI, or call /health for a simple check.",
    }
    if (accept.includes("text/html")) {
      reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arciin License Server</title>
  <style>
    :root { --bg:#09090b; --fg:#fafafa; --muted:#a1a1aa; --accent:#ff4f12; --card:#18181b; --border:#27272a; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: system-ui, sans-serif; background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255,79,18,.18), transparent), var(--bg); color: var(--fg); display:flex; align-items:center; justify-content:center; padding: 2rem; }
    .card { max-width: 32rem; width:100%; border:1px solid var(--border); background: var(--card); border-radius: 1.25rem; padding: 1.75rem; box-shadow: 0 24px 48px -24px rgba(0,0,0,.6); }
    .mark { width:2.25rem; height:2.25rem; border-radius:.75rem; background:var(--accent); display:grid; place-items:center; font-weight:700; }
    h1 { font-size:1.25rem; margin:.9rem 0 .35rem; letter-spacing:-.02em; }
    p { color:var(--muted); font-size:.9rem; line-height:1.55; margin:0 0 .75rem; }
    code { font-size:.78rem; color:#e4e4e7; background:#09090b; border:1px solid var(--border); padding:.15rem .4rem; border-radius:.4rem; }
    a { color:var(--accent); font-weight:600; text-decoration:none; }
    a:hover { text-decoration:underline; }
    ul { margin:.5rem 0 0; padding-left:1.1rem; color:var(--muted); font-size:.82rem; line-height:1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="mark">A</div>
    <h1>Arciin License Server</h1>
    <p>API only — this is not the customer account UI. There is no dashboard at this URL.</p>
    <p>Manage licenses in the <a href="http://127.0.0.1:3010/account">account portal</a> (<code>pnpm account</code>).</p>
    <p>Health check: <a href="/health"><code>/health</code></a></p>
    <ul>
      <li><code>POST /licenses/demo</code> — create demo keys</li>
      <li><code>POST /licenses/activate</code> — bind a server</li>
      <li><code>GET /account/overview</code> — portal data</li>
    </ul>
  </div>
</body>
</html>`)
      return
    }
    reply.send(payload)
  })

  app.get("/health", async (_req, reply) => {
    reply.send({ ok: true, service: "arciin-license-server" })
  })

  /**
   * Manual / demo license creation (no Stripe).
   * Protect with LICENSE_DEMO_SECRET in non-dev deployments.
   */
  app.post("/licenses/demo", async (request, reply) => {
    if (!checkDemoSecret(request as { headers: Record<string, unknown> })) {
      unauthorized(reply, "Invalid or missing demo secret.")
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

  app.post("/licenses/activate", async (request, reply) => {
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
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })

  app.post("/licenses/refresh", async (request, reply) => {
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
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })

  app.post("/licenses/deactivate", async (request, reply) => {
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
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })

  app.get("/licenses/status", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>
    const result = await getLicenseStatus({
      licenseKey: q.licenseKey,
      activationId: q.activationId,
      licenseId: q.licenseId,
    })
    if (!result.ok) {
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })

  /** Prototype admin: revoke by key (no auth beyond demo secret). */
  app.post("/licenses/revoke", async (request, reply) => {
    if (!checkDemoSecret(request as { headers: Record<string, unknown> })) {
      unauthorized(reply, "Invalid or missing demo secret.")
      return
    }
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
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })

  /**
   * Account portal overview (future account.arciin.com).
   * Demo-only: no real auth — keyed by customer email.
   */
  app.get("/account/overview", async (request, reply) => {
    if (!checkDemoSecret(request as { headers: Record<string, unknown> })) {
      unauthorized(reply, "Invalid or missing demo secret.")
      return
    }
    const q = request.query as { email?: string }
    const result = await getAccountOverview({ email: q.email })
    if (!result.ok) {
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })

  app.get("/account/licenses", async (request, reply) => {
    if (!checkDemoSecret(request as { headers: Record<string, unknown> })) {
      unauthorized(reply, "Invalid or missing demo secret.")
      return
    }
    const q = request.query as { email?: string }
    const result = await getAccountOverview({ email: q.email })
    if (!result.ok) {
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({
      data: {
        demoMode: true,
        customer: result.data.customer,
        licenses: result.data.licenses,
      },
    })
  })

  app.get("/account/activations", async (request, reply) => {
    if (!checkDemoSecret(request as { headers: Record<string, unknown> })) {
      unauthorized(reply, "Invalid or missing demo secret.")
      return
    }
    const q = request.query as { email?: string }
    const result = await getAccountOverview({ email: q.email })
    if (!result.ok) {
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({
      data: {
        demoMode: true,
        customer: result.data.customer,
        activations: result.data.activations,
      },
    })
  })

  app.post("/account/deactivate-server", async (request, reply) => {
    if (!checkDemoSecret(request as { headers: Record<string, unknown> })) {
      unauthorized(reply, "Invalid or missing demo secret.")
      return
    }
    const body = z
      .object({
        licenseId: z.string().min(1),
        instanceId: z.string().min(1),
      })
      .safeParse(request.body)
    if (!body.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "licenseId and instanceId required." },
      })
      return
    }
    const result = await deactivateByLicenseId(body.data)
    if (!result.ok) {
      reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      })
      return
    }
    reply.send({ data: result.data })
  })
}
