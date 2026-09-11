/**
 * Runtime meaning of each declared entitlement id.
 *
 * LICENSE_FEATURES is the commercial catalogue. Not every string is a shipped
 * capability, and treating placeholders as runtime gates would invent checks
 * for features that do not exist. This module is the inventory: what is real,
 * what is marketing, and which authoritative layer (if any) must enforce it.
 */

import {
  LICENSE_FEATURES,
  type LicenseFeatureId,
  type LicensePlanId,
  plansWithFeature,
} from "./entitlements"

export const ENTITLEMENT_CLASSIFICATIONS = [
  "ACTIVE",
  "PLACEHOLDER",
  "DEPRECATED",
  "INTERNAL",
] as const

export type EntitlementClassification = (typeof ENTITLEMENT_CLASSIFICATIONS)[number]

export type EntitlementRuntimeRecord = {
  id: LicenseFeatureId
  classification: EntitlementClassification
  /** What actually exists in this repository, or null when nothing ships. */
  implementedFeature: string | null
  /** Authoritative API / service gate. Frontend locks are UX only. */
  apiGate: string | null
  /** Worker re-check before paid background work. */
  workerGate: string | null
  /** Lowest plan that includes the id. */
  planRequirement: LicensePlanId
}

function lowestPlan(feature: LicenseFeatureId): LicensePlanId {
  return plansWithFeature(feature)[0] ?? "business"
}

/**
 * One row per LICENSE_FEATURES entry. Keep this exhaustive — the unit test
 * fails if a new id is added to the catalogue without a classification.
 */
export const ENTITLEMENT_RUNTIME: Record<LicenseFeatureId, EntitlementRuntimeRecord> = {
  "core.files": {
    id: "core.files",
    classification: "ACTIVE",
    implementedFeature: "Local files, assets, and libraries",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.files"),
  },
  "core.libraries": {
    id: "core.libraries",
    classification: "ACTIVE",
    implementedFeature: "Default libraries and folders",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.libraries"),
  },
  "core.uploads": {
    id: "core.uploads",
    classification: "ACTIVE",
    implementedFeature: "Uploads and URL import",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.uploads"),
  },
  "core.mobile_pwa": {
    id: "core.mobile_pwa",
    classification: "ACTIVE",
    implementedFeature: "Mobile PWA against this API",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.mobile_pwa"),
  },
  "core.basic_search": {
    id: "core.basic_search",
    classification: "ACTIVE",
    implementedFeature: "Filename / listing search",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.basic_search"),
  },
  "core.basic_logs": {
    id: "core.basic_logs",
    classification: "ACTIVE",
    implementedFeature: "Jobs list and activity feed",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.basic_logs"),
  },
  "core.basic_api": {
    id: "core.basic_api",
    classification: "ACTIVE",
    implementedFeature: "Session and scoped API access",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.basic_api"),
  },
  "core.manual_backup": {
    id: "core.manual_backup",
    classification: "ACTIVE",
    implementedFeature: "Local backup / migration scripts",
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("core.manual_backup"),
  },
  "core.basic_ai": {
    id: "core.basic_ai",
    classification: "ACTIVE",
    implementedFeature: "Connect and test one Ollama model",
    apiGate: "requireFeature(core.basic_ai) on model test",
    workerGate: null,
    planRequirement: lowestPlan("core.basic_ai"),
  },
  "ai.chat": {
    id: "ai.chat",
    classification: "ACTIVE",
    implementedFeature: "AI chat, document assist, media transcription",
    apiGate: "requireFeature(ai.chat) on chat, documents, transcripts",
    workerGate: "transcribe_media",
    planRequirement: lowestPlan("ai.chat"),
  },
  "ai.vision": {
    id: "ai.vision",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("ai.vision"),
  },
  "ai.classification": {
    id: "ai.classification",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("ai.classification"),
  },
  "ai.multi_provider": {
    id: "ai.multi_provider",
    classification: "ACTIVE",
    implementedFeature: "More than one enabled AI provider / profile",
    apiGate: "models routes check ai.multi_provider",
    workerGate: null,
    planRequirement: lowestPlan("ai.multi_provider"),
  },
  "vault.password": {
    id: "vault.password",
    classification: "ACTIVE",
    implementedFeature: "Encrypted password vault",
    apiGate: "requireFeature(vault.password)",
    workerGate: null,
    planRequirement: lowestPlan("vault.password"),
  },
  "developer.api_keys": {
    id: "developer.api_keys",
    classification: "ACTIVE",
    implementedFeature: "Developer API keys",
    apiGate: "requireFeature(developer.api_keys)",
    workerGate: null,
    planRequirement: lowestPlan("developer.api_keys"),
  },
  "developer.webhooks": {
    id: "developer.webhooks",
    classification: "ACTIVE",
    implementedFeature: "Outbound webhooks",
    apiGate: "requireFeature(developer.webhooks)",
    workerGate: null,
    planRequirement: lowestPlan("developer.webhooks"),
  },
  "developer.app_databases": {
    id: "developer.app_databases",
    classification: "ACTIVE",
    implementedFeature: "App data databases",
    apiGate: "requireFeature(developer.app_databases)",
    workerGate: null,
    planRequirement: lowestPlan("developer.app_databases"),
  },
  "ops.auto_updates": {
    id: "ops.auto_updates",
    classification: "ACTIVE",
    implementedFeature: "Automatic update staging and apply",
    apiGate: "requireFeature(ops.auto_updates) on auto-update mutate/apply",
    workerGate: "stage_update, apply_update",
    planRequirement: lowestPlan("ops.auto_updates"),
  },
  "ops.remote_access_helper": {
    id: "ops.remote_access_helper",
    classification: "ACTIVE",
    implementedFeature: "Remote access / tunnel helper",
    apiGate: "requireFeature(ops.remote_access_helper)",
    workerGate: null,
    planRequirement: lowestPlan("ops.remote_access_helper"),
  },
  "search.advanced": {
    id: "search.advanced",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("search.advanced"),
  },
  "ops.job_controls": {
    id: "ops.job_controls",
    classification: "ACTIVE",
    implementedFeature: "Clear completed/failed jobs",
    apiGate: "requireFeature(ops.job_controls) on DELETE /jobs",
    workerGate: null,
    planRequirement: lowestPlan("ops.job_controls"),
  },
  "backup.byo_bucket": {
    id: "backup.byo_bucket",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("backup.byo_bucket"),
  },
  "backup.cloud_addon": {
    id: "backup.cloud_addon",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("backup.cloud_addon"),
  },
  "team.multi_user": {
    id: "team.multi_user",
    classification: "ACTIVE",
    implementedFeature: "Settings → Users administration",
    apiGate: "requireFeature(team.multi_user)",
    workerGate: null,
    planRequirement: lowestPlan("team.multi_user"),
  },
  "team.roles": {
    id: "team.roles",
    classification: "ACTIVE",
    implementedFeature: "OWNER/ADMIN/MEMBER/VIEWER assignment (same users API)",
    apiGate: "requireFeature(team.multi_user)",
    workerGate: null,
    planRequirement: lowestPlan("team.roles"),
  },
  "team.shared_workspaces": {
    id: "team.shared_workspaces",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("team.shared_workspaces"),
  },
  "team.audit_logs": {
    id: "team.audit_logs",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("team.audit_logs"),
  },
  "team.activity_timeline": {
    id: "team.activity_timeline",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("team.activity_timeline"),
  },
  "team.user_scoped_keys": {
    id: "team.user_scoped_keys",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("team.user_scoped_keys"),
  },
  "ops.multi_server_3": {
    id: "ops.multi_server_3",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("ops.multi_server_3"),
  },
  "backup.restore_basic": {
    id: "backup.restore_basic",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("backup.restore_basic"),
  },
  "business.sso": {
    id: "business.sso",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("business.sso"),
  },
  "business.access_policies": {
    id: "business.access_policies",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("business.access_policies"),
  },
  "business.ha": {
    id: "business.ha",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("business.ha"),
  },
  "business.compliance_exports": {
    id: "business.compliance_exports",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("business.compliance_exports"),
  },
  "ops.multi_server_custom": {
    id: "ops.multi_server_custom",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("ops.multi_server_custom"),
  },
  "backup.restore_advanced": {
    id: "backup.restore_advanced",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("backup.restore_advanced"),
  },
  "support.priority": {
    id: "support.priority",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("support.priority"),
  },
  "support.dedicated": {
    id: "support.dedicated",
    classification: "PLACEHOLDER",
    implementedFeature: null,
    apiGate: null,
    workerGate: null,
    planRequirement: lowestPlan("support.dedicated"),
  },
}

/** Job names that perform paid work and must re-check the trusted licence. */
export const PAID_WORKER_JOB_FEATURES = {
  transcribe_media: "ai.chat",
  stage_update: "ops.auto_updates",
  apply_update: "ops.auto_updates",
} as const satisfies Record<string, LicenseFeatureId>

export type PaidWorkerJobName = keyof typeof PAID_WORKER_JOB_FEATURES

export function isPaidWorkerJob(name: string): name is PaidWorkerJobName {
  return Object.prototype.hasOwnProperty.call(PAID_WORKER_JOB_FEATURES, name)
}

export function featureForPaidWorkerJob(name: string): LicenseFeatureId | null {
  if (!isPaidWorkerJob(name)) return null
  return PAID_WORKER_JOB_FEATURES[name]
}

export function entitlementRuntime(id: LicenseFeatureId): EntitlementRuntimeRecord {
  return ENTITLEMENT_RUNTIME[id]
}

export function isPlaceholderEntitlement(id: LicenseFeatureId): boolean {
  return ENTITLEMENT_RUNTIME[id].classification === "PLACEHOLDER"
}

export function isActiveRuntimeEntitlement(id: LicenseFeatureId): boolean {
  return ENTITLEMENT_RUNTIME[id].classification === "ACTIVE"
}

/** Catalogue completeness — every declared id has a runtime record. */
export function classifiedEntitlementIds(): LicenseFeatureId[] {
  return [...LICENSE_FEATURES]
}
