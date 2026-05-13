import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Webhook delivery lands after the core upload, activity, and API-key workflows are stable."
      />
      <Card className="border-white/8 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-white">Planned surface</CardTitle>
          <CardDescription className="text-zinc-400">
            This MVP keeps webhooks read-only while the core event stream stabilizes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-400">
          <p>Future deliveries will reuse the same event contracts shown in Developer Events.</p>
          <p>API keys with scoped permissions will gate subscription and delivery management.</p>
          <p>Outbound signing and retry policy will be added once the upload pipeline is fully live.</p>
        </CardContent>
      </Card>
    </div>
  )
}
