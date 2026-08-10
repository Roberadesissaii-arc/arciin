/**
 * Server-side client for the hosted license server (future license.arciin.com).
 */

import { DEMO_CUSTOMER } from "@/lib/demo-customer"

function baseUrl() {
  return (process.env.LICENSE_SERVER_URL || "http://127.0.0.1:4100").replace(/\/$/, "")
}

function demoHeaders(): HeadersInit {
  const secret = process.env.LICENSE_DEMO_SECRET
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...(secret ? { "x-arciin-demo-secret": secret } : {}),
  }
}

async function lsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...demoHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!res.ok) {
    throw new Error(json.error?.message || `License server error (${res.status})`)
  }
  if (json.data === undefined) {
    throw new Error("Empty license server response")
  }
  return json.data
}

export type AccountOverview = {
  demoMode: true
  customer: {
    id: string
    name: string
    email: string
    createdAt: string
  }
  summary: {
    licenseCount: number
    activeLicenses: number
    activatedServers: number
    primaryPlan: string
    nextRenewalAt: string | null
    backupStatus: "not_connected"
  }
  licenses: AccountLicenseRow[]
  activations: AccountActivationRow[]
}

export type AccountLicenseRow = {
  id: string
  plan: string
  status: string
  keyPrefix: string
  licenseKey: string | null
  serverLimit: number
  activatedServers: number
  expiresAt: string | null
  graceDays: number
  createdAt: string
  lastCheckInAt: string | null
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
}

export type AccountActivationRow = {
  id: string
  licenseId: string
  plan: string
  instanceId: string
  instanceName: string | null
  instanceVersion: string | null
  hostname: string | null
  lastCheckInAt: string | null
  activatedAt: string
  deactivatedAt: string | null
  active: boolean
  licenseKeyPrefix: string
}

export async function fetchAccountOverview(email = DEMO_CUSTOMER.email) {
  const q = new URLSearchParams({ email })
  return lsFetch<AccountOverview>(`/account/overview?${q}`)
}

export async function createDemoLicense(plan: string) {
  return lsFetch<{
    licenseKey: string
    license: {
      id: string
      plan: string
      status: string
      serverLimit: number
      expiresAt: string | null
      keyPrefix: string
    }
    customer: { id: string; name: string; email: string }
  }>("/licenses/demo", {
    method: "POST",
    body: JSON.stringify({
      plan,
      customerName: DEMO_CUSTOMER.name,
      customerEmail: DEMO_CUSTOMER.email,
      durationDays: 30,
    }),
  })
}

export async function revokeLicense(input: { licenseId?: string; licenseKey?: string }) {
  return lsFetch<{ id: string }>("/licenses/revoke", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function deactivateServer(input: { licenseId: string; instanceId: string }) {
  return lsFetch<{ deactivated: boolean; activationId: string | null }>(
    "/account/deactivate-server",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  )
}

export async function licenseServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/health`, { cache: "no-store" })
    return res.ok
  } catch {
    return false
  }
}

export async function deleteLicense(input: { licenseId: string }) {
  return lsFetch<{ id: string }>("/licenses/delete", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
