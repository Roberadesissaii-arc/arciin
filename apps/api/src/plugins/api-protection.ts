import type { FastifyInstance } from "fastify"

import { evaluateIpAccess, parseClientDeviceLabel } from "@arciin/shared"

import { clientIpFromRequest } from "@/services/security/client-ip"
import { loadApiProtectionSettings } from "@/services/security/instance-security"
import {
  recordSecurityEvent,
  shouldRecordSecurityDedupe,
} from "@/services/security/security-events"

const EXEMPT_PREFIXES = [
  "/api/health",
  // Liveness must answer even when the database is unreachable — this hook
  // reads settings from PostgreSQL, so a probe that ran through it would
  // return 500 during exactly the outage it exists to survive.
  "/api/health/live",
  "/api/instance/status",
  "/api/instance/claim",
]

/** Exported so the exemptions can be asserted directly rather than inferred. */
export function isExempt(url: string): boolean {
  return EXEMPT_PREFIXES.some((p) => url === p || url.startsWith(`${p}?`))
}

function currentMinuteBucket(): string {
  return String(Math.floor(Date.now() / 60_000))
}

async function incrementRate(
  redis: import("ioredis").default,
  key: string,
): Promise<number> {
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, 120)
  }
  return count
}

export async function registerApiProtection(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api")) return
    if (isExempt(request.url.split("?")[0] ?? request.url)) return

    const settings = await loadApiProtectionSettings(fastify.prisma)
    const ip = clientIpFromRequest(request)
    const path = request.url.split("?")[0] ?? request.url

    const ipResult = evaluateIpAccess(ip, settings)
    if (!ipResult.allowed) {
      const reason = ipResult.reason ?? "denied"
      const userAgent =
        typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined
      const deviceLabel = parseClientDeviceLabel(userAgent)
      if (await shouldRecordSecurityDedupe(fastify.redis, `ip_denied:${ip}:${reason}`)) {
        const reasonLabel =
          reason === "ip_blocked"
            ? "blocklist"
            : reason === "allowlist_empty"
              ? "allowlist empty"
              : "not on allowlist"
        void recordSecurityEvent(fastify, {
          type: "security.ip_denied",
          title: "API request blocked",
          message: `Request blocked (${reasonLabel}).`,
          metadata: {
            clientIp: ip,
            reason,
            path,
            status: "blocked",
            deviceLabel: deviceLabel ?? undefined,
            userAgent,
          },
        }).catch(() => {})
      }

      reply.status(403).send({
        error: {
          code: "IP_FORBIDDEN",
          message:
            reason === "ip_blocked"
              ? "Your IP address is blocked from this API."
              : reason === "allowlist_empty"
                ? "IP allowlist enforcement is on but no addresses are configured."
                : "Your IP address is not on the allowlist.",
        },
      })
      return
    }

    const minute = currentMinuteBucket()

    if (settings.apiGlobalRequestsPerMinute > 0) {
      const globalKey = `arciin:rpm:global:${minute}`
      const count = await incrementRate(fastify.redis, globalKey)
      if (count > settings.apiGlobalRequestsPerMinute) {
        if (await shouldRecordSecurityDedupe(fastify.redis, `rate_global:${ip}`)) {
          void recordSecurityEvent(fastify, {
            type: "security.rate_limited",
            title: "Global API rate limit",
            message: `${ip} exceeded ${settings.apiGlobalRequestsPerMinute} requests/min on ${path}.`,
            metadata: { clientIp: ip, path, status: "limited" },
          }).catch(() => {})
        }

        reply.status(429).send({
          error: {
            code: "RATE_LIMITED",
            message: `Global API rate limit exceeded (${settings.apiGlobalRequestsPerMinute} requests per minute).`,
          },
        })
        return
      }
    }
  })
}
