import { PageHeader } from "@/components/app-shell/page-header"
import { StorageSettingsForm } from "@/components/settings/storage-settings-form"

export default function StorageSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage Settings"
        description="Inspect usage, object count, and the root path for managed local storage."
      />
      <StorageSettingsForm />
    </div>
  )
}
