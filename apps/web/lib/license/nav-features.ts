import type { LicenseFeatureId } from "@arciin/shared"

/**
 * Map primary app routes / nav ids to entitlement feature IDs.
 * Free-core routes are omitted (always allowed).
 */
export const ROUTE_FEATURE_GATES: Array<{
  match: (pathname: string) => boolean
  feature: LicenseFeatureId
}> = [
  { match: (p) => p === "/chat" || p.startsWith("/chat/"), feature: "ai.chat" },
  { match: (p) => p === "/passwords" || p.startsWith("/passwords/"), feature: "vault.password" },
  {
    match: (p) => p === "/developer/webhooks" || p.startsWith("/webhooks"),
    feature: "developer.webhooks",
  },
  {
    match: (p) => p === "/database/app-data" || p.startsWith("/database/app-data/"),
    feature: "developer.app_databases",
  },
  {
    match: (p) => p === "/developer/api-keys" || p === "/api-keys" || p.startsWith("/api-keys"),
    feature: "developer.api_keys",
  },
  {
    match: (p) => p === "/settings/users" || p.startsWith("/settings/users"),
    feature: "team.multi_user",
  },
]

/** Sidebar / command palette item → feature (if paid). */
export const NAV_ITEM_FEATURES: Record<string, LicenseFeatureId> = {
  chat: "ai.chat",
  passwords: "vault.password",
  database: "developer.app_databases",
  "api-keys": "developer.api_keys",
  webhooks: "developer.webhooks",
  users: "team.multi_user",
}

export function featureForPathname(pathname: string): LicenseFeatureId | null {
  for (const row of ROUTE_FEATURE_GATES) {
    if (row.match(pathname)) return row.feature
  }
  return null
}
