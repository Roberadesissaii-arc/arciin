import { FeatureGate } from "@/components/license/feature-gate"
import { ApiKeysApiAccessPanel } from "@/components/settings/api-keys-api-access-panel"
import { ApiKeysPageIntro } from "@/components/settings/api-keys-page-intro"
import { ApiKeysTable } from "@/components/settings/api-keys-table"

export default function DeveloperApiKeysPage() {
  return (
    <FeatureGate feature="developer.api_keys">
      <div className="w-full min-w-0 space-y-6 pb-6">
        <ApiKeysPageIntro />
        <ApiKeysApiAccessPanel />
        <ApiKeysTable />
      </div>
    </FeatureGate>
  )
}
