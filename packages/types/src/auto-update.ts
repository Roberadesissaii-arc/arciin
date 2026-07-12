export type AutoUpdateConfig = {
  enabled: boolean
  /** Preferred local hour (0-23) to run the unattended stage step. */
  hour: number | null
  stagedVersion: string | null
  stagedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

const DEFAULT_AUTO_UPDATE_CONFIG: AutoUpdateConfig = {
  enabled: false,
  hour: null,
  stagedVersion: null,
  stagedAt: null,
  lastCheckedAt: null,
  lastError: null,
}

export function parseAutoUpdateConfig(raw: unknown): AutoUpdateConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AUTO_UPDATE_CONFIG }
  const r = raw as Record<string, unknown>
  return {
    enabled: r.enabled === true,
    hour: typeof r.hour === "number" && r.hour >= 0 && r.hour <= 23 ? r.hour : null,
    stagedVersion: typeof r.stagedVersion === "string" ? r.stagedVersion : null,
    stagedAt: typeof r.stagedAt === "string" ? r.stagedAt : null,
    lastCheckedAt: typeof r.lastCheckedAt === "string" ? r.lastCheckedAt : null,
    lastError: typeof r.lastError === "string" ? r.lastError : null,
  }
}
