import { parseClientDeviceLabel } from "@arciin/shared"
import type { FastifyRequest } from "fastify"

import { clientIpFromRequest, normalizeClientIp } from "@/services/security/client-ip"

export function resolveRequestClientContext(request: FastifyRequest) {
  const ip = clientIpFromRequest(request)
  const normalizedIp = normalizeClientIp(ip) ?? undefined
  const userAgent =
    typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined
  const deviceLabel = parseClientDeviceLabel(userAgent)

  return { ip, normalizedIp, userAgent, deviceLabel }
}

export function formatAuthSecurityMessage(
  name: string,
  ip: string,
  deviceLabel?: string | null,
  verb = "signed in",
) {
  const device = deviceLabel?.trim()
  if (device) return `${name} ${verb} from ${ip} (${device}).`
  return `${name} ${verb} from ${ip}.`
}
