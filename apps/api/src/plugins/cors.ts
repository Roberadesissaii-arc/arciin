import cors from "@fastify/cors"
import type { FastifyInstance } from "fastify"

import { apiConfig } from "@/config"

const developmentOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost",
])

export async function registerCors(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }

      if (!apiConfig.isProduction || origin === apiConfig.ARCIIN_PUBLIC_URL || developmentOrigins.has(origin)) {
        callback(null, true)
        return
      }

      callback(new Error("Origin not allowed"), false)
    },
    credentials: true,
  })
}
