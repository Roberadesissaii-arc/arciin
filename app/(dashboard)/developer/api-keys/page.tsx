import { ApiKeysPageIntro } from "@/components/settings/api-keys-page-intro"
import { ApiKeysTable } from "@/components/settings/api-keys-table"

export default function DeveloperApiKeysPage() {
  return (
    <div className="w-full min-w-0 space-y-6 pb-6">
      <ApiKeysPageIntro />
      <ApiKeysTable />
    </div>
  )
}
