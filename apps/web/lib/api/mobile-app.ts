import { fetchApi } from "@/lib/api/client"
import type { MobileAppInstallStatus } from "@/lib/types/models"

export function getMobileAppInstallStatus(signal?: AbortSignal) {
  return fetchApi<MobileAppInstallStatus>("/settings/mobile-app", { method: "GET", signal })
}

export function startMobileAppInstall() {
  return fetchApi<MobileAppInstallStatus>("/settings/mobile-app/install", { method: "POST" })
}
