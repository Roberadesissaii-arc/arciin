import {
  ARCIIN_CLIENT_CHANNEL_HEADER,
  type ArciinClientChannel,
} from "@arciin/config"
import type { FastifyRequest } from "fastify"

export function resolveClientChannel(request: FastifyRequest): ArciinClientChannel {
  const raw = request.headers[ARCIIN_CLIENT_CHANNEL_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value?.trim().toLowerCase() === "mobile") return "mobile"
  return "web"
}
