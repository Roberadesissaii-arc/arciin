import { PageHeader } from "@/components/app-shell/page-header"
import { FeatureGate } from "@/components/license/feature-gate"
import { UsersPanel } from "@/components/settings/users-panel"

export default function UsersSettingsPage() {
  return (
    <FeatureGate feature="team.multi_user">
      <div className="space-y-6">
        <PageHeader
          title="Users"
          description="Owner account details and team member management."
        />
        <UsersPanel />
      </div>
    </FeatureGate>
  )
}
