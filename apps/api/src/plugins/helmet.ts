import helmet from "@fastify/helmet"
import type { FastifyInstance } from "fastify"

import { apiConfig } from "@/config"

export async function registerHelmet(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: apiConfig.ARCIIN_PUBLIC_URL.startsWith("https://") ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: apiConfig.ARCIIN_PUBLIC_URL.startsWith("https://")
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  })
}
