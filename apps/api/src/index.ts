import { createServer } from "@/server"
import { apiConfig } from "@/config"

async function start() {
  const server = await createServer()

  try {
    await server.listen({
      port: apiConfig.API_PORT,
      host: "0.0.0.0",
    })
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

start()
