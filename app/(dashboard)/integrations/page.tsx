import { PageHeader } from "@/components/app-shell/page-header"
import { IntegrationsGrid } from "@/components/settings/integrations-grid"

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Plex first, with storage and webhook integrations reserved for later phases."
      />
      <IntegrationsGrid />
    </div>
  )
}
