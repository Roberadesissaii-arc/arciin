import os from "node:os"

import { createServer } from "@/server"
import { apiConfig } from "@/config"
import { scheduleLicenseCheckIn } from "@/services/license/license-checkin"
import { scheduleCloudflareTunnelBoot } from "@/services/remote-access/tunnel-boot"

function getLanIps(): string[] {
  const interfaces = os.networkInterfaces()
  const ips: string[] = []
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address)
      }
    }
  }
  return ips
}

async function start() {
  const server = await createServer()

  try {
    await server.listen({
      port: apiConfig.API_PORT,
      host: "0.0.0.0",
    })

    const lanIps = getLanIps()
    server.log.info("─────────────────────────────────────────")
    server.log.info(`  Arciin API v${apiConfig.appVersion} — ready`)
    server.log.info(`  Local:    http://127.0.0.1:${apiConfig.API_PORT}`)
    for (const ip of lanIps) {
      server.log.info(`  Network:  http://${ip}:${apiConfig.API_PORT}`)
    }
    server.log.info(`  Public:   ${apiConfig.ARCIIN_PUBLIC_URL}`)
    server.log.info("─────────────────────────────────────────")
    scheduleCloudflareTunnelBoot(server)
    scheduleLicenseCheckIn(server)
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

start()
