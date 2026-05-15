"use client"

import { useQuery } from "@tanstack/react-query"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { CreateApiKeyDialog } from "@/components/settings/create-api-key-dialog"
import { getApiKeys } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

export function ApiKeysPageIntro() {
  const keysQuery = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: ({ signal }) => getApiKeys(signal),
  })
  const keys = keysQuery.data ?? []
  const active = keys.filter((k) => !k.revokedAt).length
  const revoked = keys.filter((k) => k.revokedAt).length
  const scopeCount = new Set(keys.flatMap((k) => k.scopes)).size

  return (
    <DashboardPageIntro
      title="API keys"
      subtitle="Bearer tokens · scoped access · hashed at rest"
      description="Create keys for scripts, CI, or integrations. Raw values are shown once; the server stores only a hash and prefix. Rotate or revoke from the table below when access changes."
      actions={<CreateApiKeyDialog />}
      stats={[
        {
          label: "Total keys",
          value: keysQuery.isLoading ? "…" : keys.length.toLocaleString(),
        },
        {
          label: "Active",
          value: keysQuery.isLoading ? "…" : active.toLocaleString(),
        },
        {
          label: "Revoked",
          value: keysQuery.isLoading ? "…" : revoked.toLocaleString(),
        },
        {
          label: "Scope types in use",
          value: keysQuery.isLoading ? "…" : scopeCount.toLocaleString(),
        },
      ]}
    />
  )
}
