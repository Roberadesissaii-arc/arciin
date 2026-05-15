import { PageHeader } from "@/components/app-shell/page-header"
import { UsersPanel } from "@/components/settings/users-panel"

export default function UsersSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Owner account details and future member management."
      />
      <UsersPanel />
    </div>
  )
}

