import multipart from "@fastify/multipart"
import type { FastifyInstance } from "fastify"

import { apiConfig } from "@/config"

export async function registerMultipart(fastify: FastifyInstance) {
  await fastify.register(multipart, {
    limits: {
      fileSize: apiConfig.maxUploadSizeBytes,
    },
  })
}
