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

export type DemoLicenseCreated = {
  licenseKey: string
  license: {
    id: string
    plan: string
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
    createdAt: string
  }
  customer: {
    id: string
    name: string
    email: string
  }
}

export type HostedLicenseStatus = {
  license: {
    id: string
    plan: string
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
    createdAt: string
  }
  customer: {
    id: string
    name: string
    email: string
  } | null
  activations: Array<{
    id: string
    instanceId: string
    instanceName: string | null
    instanceVersion: string | null
    hostname: string | null
    lastCheckInAt: string | null
    activatedAt: string
    deactivatedAt: string | null
    active: boolean
  }>
  servers: {
    activated: number
    limit: number
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

export function createDemoLicense(input: {
  plan: string
  customerName?: string
  customerEmail?: string
  durationDays?: number
  serverLimit?: number
  graceDays?: number
}) {
  return fetchApi<DemoLicenseCreated>("/license/demo", {
    method: "POST",
    body: input,
  })
}

export function getHostedLicenseStatus(
  query: { licenseKey?: string; licenseId?: string; activationId?: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  if (query.licenseKey) params.set("licenseKey", query.licenseKey)
  if (query.licenseId) params.set("licenseId", query.licenseId)
  if (query.activationId) params.set("activationId", query.activationId)
  const qs = params.toString()
  return fetchApi<HostedLicenseStatus>(`/license/hosted-status${qs ? `?${qs}` : ""}`, {
    method: "GET",
    signal,
  })
}
