import { apiConfig } from "@/config"

export type UpdateManifest = {
  latest: string
  channel?: string
  changelogUrl?: string
  notes?: string
}

export type UpdateCheckResult = {
  configured: boolean
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  channel: string | null
  changelogUrl: string | null
  notes: string | null
  checkedAt: string
  error: string | null
}

let cached: { result: UpdateCheckResult; expiresAt: number } | null = null
const CACHE_TTL_MS = 10 * 60 * 1000
const FAILURE_CACHE_TTL_MS = 60 * 1000

/** Compares dotted numeric versions (e.g. "0.2.0" > "0.1.9"). */
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split(".").map((p) => parseInt(p, 10))
  const b = current.split(".").map((p) => parseInt(p, 10))
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (Number.isNaN(av) || Number.isNaN(bv)) continue
    if (av !== bv) return av > bv
  }
  return false
}

/**
 * Polls the configured update manifest and reports whether a newer Arciin
 * release exists. Never throws — a missing/unreachable manifest is reported
 * as a soft error so the UI can degrade to "couldn't check" instead of
 * breaking the settings page.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.result

  const base = {
    configured: Boolean(apiConfig.updateManifestUrl),
    currentVersion: apiConfig.appVersion,
    latestVersion: null as string | null,
    updateAvailable: false,
    channel: null as string | null,
    changelogUrl: null as string | null,
    notes: null as string | null,
    checkedAt: new Date(now).toISOString(),
  }

  if (!apiConfig.updateManifestUrl) {
    const result: UpdateCheckResult = { ...base, error: null }
    cached = { result, expiresAt: now + CACHE_TTL_MS }
    return result
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(apiConfig.updateManifestUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) throw new Error(`Manifest request failed (${res.status})`)
    const manifest = (await res.json()) as UpdateManifest
    if (!manifest.latest || typeof manifest.latest !== "string") {
      throw new Error("Manifest is missing a valid \"latest\" version")
    }

    const result: UpdateCheckResult = {
      ...base,
      latestVersion: manifest.latest,
      updateAvailable: isNewerVersion(manifest.latest, apiConfig.appVersion),
      channel: manifest.channel ?? null,
      changelogUrl: manifest.changelogUrl ?? null,
      notes: manifest.notes ?? null,
      error: null,
    }
    cached = { result, expiresAt: now + CACHE_TTL_MS }
    return result
  } catch (err) {
    const result: UpdateCheckResult = {
      ...base,
      error: err instanceof Error ? err.message : "Could not check for updates.",
    }
    cached = { result, expiresAt: now + FAILURE_CACHE_TTL_MS }
    return result
  }
}

export function invalidateUpdateCheckCache() {
  cached = null
}
