import {
  ARCIIN_CLIENT_CHANNEL_HEADER,
  type ArciinClientChannel,
} from "@arciin/config"
import type { FastifyRequest } from "fastify"

/**
 * Resolve the upload channel for badge / All Files filtering.
 * API-key auth always wins as "api" so remote integrations are distinguishable
 * from dashboard (web) and mobile PWA uploads.
 */
export function resolveClientChannel(request: FastifyRequest): ArciinClientChannel {
  if (request.auth?.apiKeyId) return "api"

  const raw = request.headers[ARCIIN_CLIENT_CHANNEL_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value?.trim().toLowerCase() === "mobile") return "mobile"
  if (value?.trim().toLowerCase() === "api") return "api"
  return "web"
}
