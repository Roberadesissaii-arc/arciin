/**
 * Central plan entitlement matrix for Arciin.
 * Free core never locks local files — only premium capabilities are gated.
 *
 * Source of truth for Free / Pro / Team / Business feature flags.
 * Backend `requireFeature` and Settings → License both use this map.
 */

export const LICENSE_PLANS = ["free", "pro", "team", "business"] as const
export type LicensePlanId = (typeof LICENSE_PLANS)[number]

/** Stable feature keys enforced by the API (not only UI). */
export const LICENSE_FEATURES = [
  // Free core (always on for free+)
  "core.files",
  "core.libraries",
  "core.uploads",
  "core.mobile_pwa",
  "core.basic_search",
  "core.basic_logs",
  "core.basic_api",
  "core.manual_backup",
  "core.basic_ai",

  // Pro+
  "ai.chat",
  "ai.vision",
  "ai.classification",
  "ai.multi_provider",
  "vault.password",
  "developer.api_keys",
  "developer.webhooks",
  "developer.app_databases",
  "ops.auto_updates",
  "ops.remote_access_helper",
  "search.advanced",
  "ops.job_controls",
  "backup.byo_bucket",
  "backup.cloud_addon",

  // Team+
  "team.multi_user",
  "team.roles",
  "team.shared_workspaces",
  "team.audit_logs",
  "team.activity_timeline",
  "team.user_scoped_keys",
  "ops.multi_server_3",
  "backup.restore_basic",

  // Business
  "business.sso",
  "business.access_policies",
  "business.ha",
  "business.compliance_exports",
  "ops.multi_server_custom",
  "backup.restore_advanced",
  "support.priority",
  "support.dedicated",
] as const

export type LicenseFeatureId = (typeof LICENSE_FEATURES)[number]

export type PlanDefinition = {
  id: LicensePlanId
  name: string
  description: string
  maxServers: number | "custom"
  features: readonly LicenseFeatureId[]
}

const FREE_FEATURES = [
  "core.files",
  "core.libraries",
  "core.uploads",
  "core.mobile_pwa",
  "core.basic_search",
  "core.basic_logs",
  "core.basic_api",
  "core.manual_backup",
  "core.basic_ai",
] as const satisfies readonly LicenseFeatureId[]

const PRO_FEATURES = [
  ...FREE_FEATURES,
  "ai.chat",
  "ai.vision",
  "ai.classification",
  "ai.multi_provider",
  "vault.password",
  "developer.api_keys",
  "developer.webhooks",
  "developer.app_databases",
  "ops.auto_updates",
  "ops.remote_access_helper",
  "search.advanced",
  "ops.job_controls",
  "backup.byo_bucket",
  "backup.cloud_addon",
  "support.priority",
] as const satisfies readonly LicenseFeatureId[]

const TEAM_FEATURES = [
  ...PRO_FEATURES,
  "team.multi_user",
  "team.roles",
  "team.shared_workspaces",
  "team.audit_logs",
  "team.activity_timeline",
  "team.user_scoped_keys",
  "ops.multi_server_3",
  "backup.restore_basic",
] as const satisfies readonly LicenseFeatureId[]

const BUSINESS_FEATURES = [
  ...TEAM_FEATURES,
  "business.sso",
  "business.access_policies",
  "business.ha",
  "business.compliance_exports",
  "ops.multi_server_custom",
  "backup.restore_advanced",
  "support.dedicated",
] as const satisfies readonly LicenseFeatureId[]

export const PLAN_DEFINITIONS: Record<LicensePlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    description: "Self-hosted core — files, libraries, uploads, PWA, basic tools on your disk.",
    maxServers: 1,
    features: FREE_FEATURES,
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "Full AI workflows, vault, developer tools, and automation on one server.",
    maxServers: 1,
    features: PRO_FEATURES,
  },
  team: {
    id: "team",
    name: "Team",
    description: "Multi-user collaboration, audit, and up to three registered servers.",
    maxServers: 3,
    features: TEAM_FEATURES,
  },
  business: {
    id: "business",
    name: "Business",
    description: "SSO, compliance, fleet licensing, and dedicated support.",
    maxServers: "custom",
    features: BUSINESS_FEATURES,
  },
}

export function isLicensePlanId(value: string | null | undefined): value is LicensePlanId {
  return !!value && (LICENSE_PLANS as readonly string[]).includes(value)
}

export function isLicenseFeatureId(value: string | null | undefined): value is LicenseFeatureId {
  return !!value && (LICENSE_FEATURES as readonly string[]).includes(value)
}

export function featuresForPlan(plan: LicensePlanId): readonly LicenseFeatureId[] {
  return PLAN_DEFINITIONS[plan].features
}

export function planHasFeature(plan: LicensePlanId, feature: LicenseFeatureId): boolean {
  return (PLAN_DEFINITIONS[plan].features as readonly string[]).includes(feature)
}

export function plansWithFeature(feature: LicenseFeatureId): LicensePlanId[] {
  return LICENSE_PLANS.filter((plan) => planHasFeature(plan, feature))
}

/** Human labels for Settings → License UI */
export const FEATURE_LABELS: Record<LicenseFeatureId, string> = {
  "core.files": "Files & libraries",
  "core.libraries": "Default libraries",
  "core.uploads": "Uploads",
  "core.mobile_pwa": "Mobile PWA",
  "core.basic_search": "Basic search",
  "core.basic_logs": "Basic logs & jobs",
  "core.basic_api": "Basic API access",
  "core.manual_backup": "Manual local backup",
  "core.basic_ai": "Connect and test one Ollama model",
  "ai.chat": "Full AI chat with files",
  "ai.vision": "Image / vision understanding",
  "ai.classification": "Smart classification",
  "ai.multi_provider": "Multiple AI providers",
  "vault.password": "Encrypted password vault",
  "developer.api_keys": "Developer API keys",
  "developer.webhooks": "Webhooks",
  "developer.app_databases": "App data databases",
  "ops.auto_updates": "Automatic updates",
  "ops.remote_access_helper": "Remote access helper",
  "search.advanced": "Advanced search",
  "ops.job_controls": "Background job controls",
  "backup.byo_bucket": "Bring-your-own backup storage",
  "backup.cloud_addon": "Arciin cloud backup add-on",
  "team.multi_user": "Multiple users",
  "team.roles": "Roles & permissions",
  "team.shared_workspaces": "Shared workspaces",
  "team.audit_logs": "Audit logs",
  "team.activity_timeline": "Team activity timeline",
  "team.user_scoped_keys": "User-scoped API keys",
  "ops.multi_server_3": "Up to 3 registered servers",
  "backup.restore_basic": "Basic restore points",
  "business.sso": "SSO",
  "business.access_policies": "Advanced access policies",
  "business.ha": "High availability support",
  "business.compliance_exports": "Compliance exports",
  "ops.multi_server_custom": "Custom multi-server licenses",
  "backup.restore_advanced": "Advanced restore & retention",
  "support.priority": "Priority support",
  "support.dedicated": "Dedicated support",
}
