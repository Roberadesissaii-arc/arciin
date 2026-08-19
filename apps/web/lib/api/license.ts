import { fetchApi } from "@/lib/api/client"

export type LicenseFeatureRow = {
  id: string
  label: string
}

export type LicenseStatusView = {
  plan: string
  planName: string
  planDescription: string
  status: "none" | "active" | "grace" | "expired" | string
  instanceId: string | null
  keyPrefix: string | null
  activatedAt: string | null
  expiresAt: string | null
  graceUntil: string | null
  features: LicenseFeatureRow[]
  isFreeCore: boolean
  premiumActive: boolean
  source: string
  servers?: {
    activated: number
    limit: number | "custom"
    lastCheckIn: string | null
  }
  mockKeysHint: string[]
  licenseServerConfigured?: boolean
  licenseServerUrl?: string | null
}



export function getLicenseStatus(signal?: AbortSignal) {
  return fetchApi<LicenseStatusView>("/license/status", { method: "GET", signal })
}

export function activateLicense(licenseKey: string, durationDays?: number) {
  return fetchApi<LicenseStatusView>("/license/activate", {
    method: "POST",
    body: { licenseKey, durationDays },
  })
}

export function refreshLicense() {
  return fetchApi<LicenseStatusView>("/license/refresh", { method: "POST" })
}

export function deactivateLicense() {
  return fetchApi<LicenseStatusView>("/license/deactivate", { method: "POST" })
}
