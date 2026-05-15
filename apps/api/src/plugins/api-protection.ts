import type { FastifyInstance, FastifyRequest } from "fastify"

import { evaluateIpAccess } from "@arciin/shared"

import { loadApiProtectionSettings } from "@/services/security/instance-security"

const EXEMPT_PREFIXES = [
  "/api/health",
  "/api/instance/status",
  "/api/instance/claim",
  "/api/auth/login",
  "/api/auth/register",
]

function isExempt(url: string): boolean {
  return EXEMPT_PREFIXES.some((p) => url === p || url.startsWith(`${p}?`))
}

function currentMinuteBucket(): string {
  return String(Math.floor(Date.now() / 60_000))
}

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"]
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return request.ip
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
    const ip = clientIp(request)

    const ipResult = evaluateIpAccess(ip, settings)
    if (!ipResult.allowed) {
      reply.status(403).send({
        error: {
          code: "IP_FORBIDDEN",
          message:
            ipResult.reason === "ip_blocked"
              ? "Your IP address is blocked from this API."
              : ipResult.reason === "allowlist_empty"
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
