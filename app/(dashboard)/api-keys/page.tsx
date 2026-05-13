import { PageHeader } from "@/components/app-shell/page-header"
import { ApiKeysTable } from "@/components/settings/api-keys-table"

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="Scoped access keys for automations, integrations, and developer tooling."
      />
      <ApiKeysTable />
    </div>
  )
}
