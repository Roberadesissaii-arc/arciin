import cors from "@fastify/cors"
import type { FastifyInstance } from "fastify"

import { apiConfig } from "@/config"

const developmentOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost",
])

function isCloudflareQuickTunnelOrigin(origin: string) {
  try {
    const { hostname, protocol } = new URL(origin)
    return protocol === "https:" && hostname.endsWith(".trycloudflare.com")
  } catch {
    return false
  }
}

export async function registerCors(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }

      if (
        !apiConfig.isProduction ||
        origin === apiConfig.ARCIIN_PUBLIC_URL ||
        developmentOrigins.has(origin) ||
        isCloudflareQuickTunnelOrigin(origin)
      ) {
        callback(null, true)
        return
      }

      callback(new Error("Origin not allowed"), false)
    },
    credentials: true,
  })
}
