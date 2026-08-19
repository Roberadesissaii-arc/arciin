/**
 * HTTP client for the hosted license server prototype (future license.arciin.com).
 */

import type { LicenseServerActivateResponse } from "@arciin/config"

import { apiConfig } from "@/config"

export function licenseServerBaseUrl(): string | null {
  const url = apiConfig.ARCIIN_LICENSE_SERVER_URL?.replace(/\/$/, "")
  return url || null
}

/**
 * Verification material for entitlement tokens.
 *
 * Public keys only. This instance can check that the licensing authority signed
 * a token; it cannot produce one. That asymmetry is the whole point — under the
 * previous HMAC scheme the value needed to verify was also the value needed to
 * forge, so every customer holding it could mint themselves any plan.
 */
export function licenseVerifyOptions(expectedInstanceId?: string) {
  return {
    publicKeys: apiConfig.licensePublicKeyRegistry,
    legacyHmacSecret: apiConfig.legacyLicenseSecret,
    ...(expectedInstanceId ? { expectedInstanceId } : {}),
  }
}

export function licenseDevFallbackEnabled(): boolean {
  if (apiConfig.ARCIIN_LICENSE_DEV_FALLBACK !== undefined) {
    return apiConfig.ARCIIN_LICENSE_DEV_FALLBACK
  }
  return apiConfig.NODE_ENV !== "production"
}

type HostedError = {
  ok: false
  code: string
  message: string
  status: number
  unreachable?: boolean
}

type HostedOk<T> = { ok: true; data: T }

async function licenseFetch<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<HostedOk<T> | HostedError> {
  const base = licenseServerBaseUrl()
  if (!base) {
    return {
      ok: false,
      code: "LICENSE_SERVER_NOT_CONFIGURED",
      message: "ARCIIN_LICENSE_SERVER_URL is not set.",
      status: 503,
    }
  }

  const timeoutMs = init?.timeoutMs ?? 8_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    })
    const json = (await res.json().catch(() => ({}))) as {
      data?: T
      error?: { code?: string; message?: string }
    }
    if (!res.ok) {
      return {
        ok: false,
        code: json.error?.code ?? "LICENSE_SERVER_ERROR",
        message: json.error?.message ?? `License server returned ${res.status}`,
        status: res.status,
      }
    }
    if (!json.data) {
      return {
        ok: false,
        code: "LICENSE_SERVER_ERROR",
        message: "License server returned an empty payload.",
        status: 502,
      }
    }
    return { ok: true, data: json.data }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "License server timed out."
          : err.message
        : "License server unreachable."
    return {
      ok: false,
      code: "LICENSE_SERVER_UNREACHABLE",
      message,
      status: 503,
      unreachable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function hostedActivate(body: {
  licenseKey: string
  instanceId: string
  instanceName?: string
  version?: string
  hostname?: string
}) {
  return licenseFetch<LicenseServerActivateResponse>("/licenses/activate", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function hostedRefresh(body: {
  token?: string
  licenseKey?: string
  instanceId?: string
}) {
  return licenseFetch<LicenseServerActivateResponse>("/licenses/refresh", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function hostedDeactivate(body: {
  licenseKey?: string
  token?: string
  instanceId: string
}) {
  return licenseFetch<{ deactivated: boolean; activationId: string | null }>(
    "/licenses/deactivate",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  )
}
