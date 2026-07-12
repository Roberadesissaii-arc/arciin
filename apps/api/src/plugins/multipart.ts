import multipart from "@fastify/multipart"
import type { FastifyInstance } from "fastify"

/** Enforced per upload in writeMultipartToTemp — see upload-limits service. */
const MULTIPART_STREAM_CEILING_BYTES = 1024 * 1024 * 1024 * 1024

export async function registerMultipart(fastify: FastifyInstance) {
  await fastify.register(multipart, {
    limits: {
      fileSize: MULTIPART_STREAM_CEILING_BYTES,
    },
  })
}
