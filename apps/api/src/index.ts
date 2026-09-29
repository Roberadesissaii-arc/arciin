import { createServer } from "@/server"
import { apiConfig } from "@/config"
import { scheduleLicenseCheckIn } from "@/services/license/license-checkin"
import { scheduleResumableUploadCleanup } from "@/services/file-requests/resumable-cleanup"
import { getLanIpv4Addresses } from "@/services/remote-access/local-access-urls"
import { startupBannerLines } from "@/services/remote-access/startup-banner"
import { scheduleCloudflareTunnelBoot } from "@/services/remote-access/tunnel-boot"

async function start() {
  const server = await createServer()

  try {
    await server.listen({
      port: apiConfig.API_PORT,
      host: "0.0.0.0",
    })

    const banner = startupBannerLines({
      appVersion: apiConfig.appVersion,
      apiPort: apiConfig.API_PORT,
      lanHosts: getLanIpv4Addresses(),
      publicUrl: apiConfig.ARCIIN_PUBLIC_URL,
    })
    for (const line of banner.info) server.log.info(line)
    for (const line of banner.warnings) server.log.warn(line)
    scheduleCloudflareTunnelBoot(server)
    scheduleLicenseCheckIn(server)
    scheduleResumableUploadCleanup(server)
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

start()
