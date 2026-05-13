import cookie from "@fastify/cookie"
import type { FastifyInstance } from "fastify"

import { apiConfig } from "@/config"

export async function registerCookies(fastify: FastifyInstance) {
  await fastify.register(cookie, {
    secret: apiConfig.SESSION_SECRET,
  })
}
