import { StoragePageIntro } from "@/components/settings/storage-page-intro"
import { StorageSettingsForm } from "@/components/settings/storage-settings-form"

export default function StorageSettingsPage() {
  return (
    <div className="space-y-6 pb-6">
      <StoragePageIntro />
      <StorageSettingsForm />
    </div>
  )
}
