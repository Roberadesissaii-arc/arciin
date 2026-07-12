"use client"

import { IntegrationsGrid } from "@/components/settings/integrations-grid"
import { IntegrationsPageIntro } from "@/components/settings/integrations-page-intro"

export default function IntegrationsPage() {
  return (
    <div className="space-y-6 pb-6">
      <IntegrationsPageIntro />
      <IntegrationsGrid />
    </div>
  )
}
