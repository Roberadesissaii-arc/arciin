import {
  FEATURE_LABELS,
  featuresForPlan,
  isLicensePlanId,
  type LicenseFeatureId,
  type LicensePlanId,
  PLAN_DEFINITIONS,
} from "./entitlements"

/** License lifecycle for this instance. */
export type LicenseStatus = "none" | "active" | "grace" | "expired"

export type LicenseStateSnapshot = {
  plan: LicensePlanId
  status: LicenseStatus
  /** Stable id for this install (InstanceConfig.id). */
  instanceId: string | null
  /** Display prefix of the last activated key (never store full key in UI logs). */
  keyPrefix: string | null
  activatedAt: string | null
  expiresAt: string | null
  /** Premium features remain available until this time after expiry. */
  graceUntil: string | null
  features: LicenseFeatureId[]
  /** Opaque signed blob — verified locally; real cloud later. */
  signedToken: string | null
  source: "default" | "mock_dev" | "token" | "hosted"
  /** True when plan is free or status allows only free features. */
  isFreeCore: boolean
  /** True when premium features are currently allowed (active or grace). */
  premiumActive: boolean
}

/** Default offline grace after paid period ends (7 days). */
export const LICENSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/** Fixed mock/dev keys for local testing (no license cloud yet). */
export const MOCK_LICENSE_KEYS: Record<string, LicensePlanId> = {
  "ARCIIN-DEV-FREE": "free",
  "ARCIIN-DEV-PRO": "pro",
  "ARCIIN-DEV-TEAM": "team",
  "ARCIIN-DEV-BUSINESS": "business",
  // Shorter aliases
  "DEV-FREE": "free",
  "DEV-PRO": "pro",
  "DEV-TEAM": "team",
  "DEV-BUSINESS": "business",
}

export function normalizeLicenseKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "")
}

/**
 * Resolve plan from demo/dev keys:
 * - ARCIIN-DEV-PRO / DEV-TEAM
 * - DEV-PRO-30D
 * - arc_demo_pro_xxxxxxxxx (any suffix after plan)
 */
export function resolveMockPlanFromKey(rawKey: string): LicensePlanId | null {
  const key = normalizeLicenseKey(rawKey)
  if (MOCK_LICENSE_KEYS[key]) return MOCK_LICENSE_KEYS[key]

  // DEV-PRO-30D style
  const m = /^DEV-(FREE|PRO|TEAM|BUSINESS)(?:-(\d+)D)?$/.exec(key)
  if (m) {
    const plan = m[1]!.toLowerCase()
    if (isLicensePlanId(plan)) return plan
  }

  // arc_demo_pro_… / ARC_DEMO_TEAM_…
  const demo = /^ARC_DEMO_(FREE|PRO|TEAM|BUSINESS)(?:[_-](.+))?$/.exec(key)
  if (demo) {
    const plan = demo[1]!.toLowerCase()
    if (isLicensePlanId(plan)) return plan
  }

  return null
}

/** Generate a portal-style demo key (client or server). */
export function generateDemoLicenseKey(plan: LicensePlanId, suffix?: string): string {
  const id =
    suffix ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `arc_demo_${plan}_${id}`
}

export function keyDisplayPrefix(rawKey: string): string {
  const key = normalizeLicenseKey(rawKey)
  if (key.length <= 14) return key
  return `${key.slice(0, 12)}…${key.slice(-4)}`
}

export function serverLimitForPlan(plan: LicensePlanId): number | "custom" {
  return PLAN_DEFINITIONS[plan].maxServers
}

export function defaultLicenseSnapshot(instanceId: string | null): LicenseStateSnapshot {
  const features = [...featuresForPlan("free")]
  return {
    plan: "free",
    status: "none",
    instanceId,
    keyPrefix: null,
    activatedAt: null,
    expiresAt: null,
    graceUntil: null,
    features,
    signedToken: null,
    source: "default",
    isFreeCore: true,
    premiumActive: false,
  }
}

/**
 * Compute effective status + features from stored timestamps.
 * Expired + within grace → grace (premium still on). After grace → free core only.
 */
export function evaluateLicenseState(input: {
  plan: string | null | undefined
  status: string | null | undefined
  instanceId: string | null
  keyPrefix: string | null
  activatedAt: Date | string | null
  expiresAt: Date | string | null
  graceUntil: Date | string | null
  signedToken: string | null
  source?: string | null
  now?: Date
}): LicenseStateSnapshot {
  const now = input.now ?? new Date()
  const plan: LicensePlanId = isLicensePlanId(input.plan) ? input.plan : "free"
  const activatedAt =
    input.activatedAt instanceof Date
      ? input.activatedAt.toISOString()
      : input.activatedAt
  const expiresAt =
    input.expiresAt instanceof Date
      ? input.expiresAt.toISOString()
      : input.expiresAt
  const graceUntil =
    input.graceUntil instanceof Date
      ? input.graceUntil.toISOString()
      : input.graceUntil

  if (plan === "free" || !input.signedToken) {
    return {
      ...defaultLicenseSnapshot(input.instanceId),
      plan: "free",
      status: input.signedToken ? "active" : "none",
      instanceId: input.instanceId,
      keyPrefix: input.keyPrefix,
      activatedAt,
      expiresAt: null,
      graceUntil: null,
      signedToken: input.signedToken,
      source:
        input.source === "mock_dev"
          ? "mock_dev"
          : input.source === "hosted"
            ? "hosted"
            : input.signedToken
              ? "token"
              : "default",
    }
  }

  const exp = expiresAt ? new Date(expiresAt) : null
  const grace = graceUntil ? new Date(graceUntil) : null

  let status: LicenseStateSnapshot["status"] = "active"
  let effectivePlan: LicensePlanId = plan
  let premiumActive = true

  if (exp && exp.getTime() <= now.getTime()) {
    if (grace && grace.getTime() > now.getTime()) {
      status = "grace"
      premiumActive = true
    } else {
      status = "expired"
      premiumActive = false
      effectivePlan = "free"
    }
  }

  const features = [...featuresForPlan(effectivePlan)]

  const source: LicenseStateSnapshot["source"] =
    input.source === "mock_dev"
      ? "mock_dev"
      : input.source === "hosted"
        ? "hosted"
        : "token"

  return {
    plan: effectivePlan,
    status,
    instanceId: input.instanceId,
    keyPrefix: input.keyPrefix,
    activatedAt,
    expiresAt,
    graceUntil,
    features,
    signedToken: input.signedToken,
    source,
    isFreeCore: effectivePlan === "free" || !premiumActive,
    premiumActive,
  }
}

export function hasFeature(
  snapshot: LicenseStateSnapshot,
  feature: LicenseFeatureId,
): boolean {
  return snapshot.features.includes(feature)
}

export function publicLicenseView(snapshot: LicenseStateSnapshot) {
  const maxServers = serverLimitForPlan(snapshot.plan)
  const activatedServers =
    snapshot.premiumActive && snapshot.plan !== "free" && snapshot.instanceId ? 1 : 0

  return {
    plan: snapshot.plan,
    planName: PLAN_DEFINITIONS[snapshot.plan].name,
    planDescription: PLAN_DEFINITIONS[snapshot.plan].description,
    status: snapshot.status,
    instanceId: snapshot.instanceId,
    keyPrefix: snapshot.keyPrefix,
    activatedAt: snapshot.activatedAt,
    expiresAt: snapshot.expiresAt,
    graceUntil: snapshot.graceUntil,
    features: snapshot.features.map((id) => ({
      id,
      label: FEATURE_LABELS[id] ?? id,
    })),
    isFreeCore: snapshot.isFreeCore,
    premiumActive: snapshot.premiumActive,
    source: snapshot.source,
    /** Prototype server registration (real multi-server later). */
    servers: {
      activated: activatedServers,
      limit: maxServers,
      lastCheckIn: snapshot.activatedAt ?? snapshot.expiresAt ?? null,
    },
    mockKeysHint: [
      "arc_demo_pro_… (hosted demo portal)",
      "arc_demo_team_…",
      "arc_demo_business_…",
      "ARCIIN-DEV-PRO (local fallback)",
    ],
  }
}
