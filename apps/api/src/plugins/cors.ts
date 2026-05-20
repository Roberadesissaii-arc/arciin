import cors from "@fastify/cors"
import type { FastifyInstance } from "fastify"

import { isCorsOriginAllowed } from "@/plugins/cors-origins"

export async function registerCors(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }

      if (isCorsOriginAllowed(origin)) {
        callback(null, origin)
        return
      }

      callback(new Error("Origin not allowed"), false)
    },
    credentials: true,
  })
}
