import { fetchApi } from "@/lib/api/client"
import type {
  MobileConnectionSettings,
  MobilePairingCodeResult,
} from "@/lib/types/models"

export function getMobileConnectionSettings(signal?: AbortSignal) {
  return fetchApi<MobileConnectionSettings>("/settings/mobile-connection", {
    method: "GET",
    signal,
  })
}

export function createMobilePairingCode() {
  return fetchApi<MobilePairingCodeResult>("/settings/mobile-connection/code", {
    method: "POST",
    body: {},
  })
}

export function revokeMobilePairingCode() {
  return fetchApi<{ revoked: true }>("/settings/mobile-connection/code", {
    method: "DELETE",
  })
}

export function revokeMobileDevice(sessionId: string) {
  return fetchApi<{ revoked: true }>(`/settings/mobile-connection/devices/${sessionId}`, {
    method: "DELETE",
  })
}
