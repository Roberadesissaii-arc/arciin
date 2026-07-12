import { FeatureGate } from "@/components/license/feature-gate"
import { WebhooksManager } from "@/components/webhooks/webhooks-manager"

export default function DeveloperWebhooksPage() {
  return (
    <FeatureGate feature="developer.webhooks">
      <WebhooksManager />
    </FeatureGate>
  )
}
