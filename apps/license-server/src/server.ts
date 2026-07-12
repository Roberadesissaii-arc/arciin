import Fastify from "fastify"

import { registerLicenseRoutes } from "./routes/licenses.js"

export async function buildLicenseServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  })

  await registerLicenseRoutes(app)
  return app
}
