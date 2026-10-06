import { fetchApi } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

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



/** A server holding one of this licence's seats (no hostname, short id only). */
export type LicenseBoundServer = {
  name: string | null
  instanceIdShort: string
  version: string | null
  lastCheckInAt: string | null
  activatedAt: string
}

export type LicenseSeatLimit = {
  serverLimit: number
  servers: LicenseBoundServer[]
  manageUrl: string
}

/** The seat details of a SERVER_LIMIT_REACHED activation error, if that is what `error` is. */
export function seatLimitFromError(error: unknown): LicenseSeatLimit | null {
  if (!(error instanceof ApiError) || error.code !== "SERVER_LIMIT_REACHED") return null
  const details = error.details as Partial<LicenseSeatLimit> | undefined
  return {
    serverLimit: typeof details?.serverLimit === "number" ? details.serverLimit : 0,
    servers: Array.isArray(details?.servers) ? details.servers : [],
    manageUrl: typeof details?.manageUrl === "string" ? details.manageUrl : "https://arciin.com/account",
  }
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
