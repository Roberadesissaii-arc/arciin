import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function DeveloperSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer"
        description="API base URL, authentication model, and integration reference for this instance."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">API Base URL</CardTitle>
            <CardDescription className="text-zinc-400">
              The base endpoint for all Arciin API requests from this instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="rounded-md bg-white/[0.05] px-3 py-2 text-[13px] text-white/70">
              http://localhost:3001/api
            </code>
          </CardContent>
        </Card>
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Authentication</CardTitle>
            <CardDescription className="text-zinc-400">
              API requests authenticate via bearer token. Generate keys from the API Keys page.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">
            Use <code className="text-zinc-400">Authorization: Bearer &lt;key&gt;</code> on each request.
          </CardContent>
        </Card>
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Webhooks</CardTitle>
            <CardDescription className="text-zinc-400">
              Subscribe to asset, library, and job events via outbound webhooks.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">Configure from the Webhooks page.</CardContent>
        </Card>
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Events Stream</CardTitle>
            <CardDescription className="text-zinc-400">
              Real-time server-sent events for upload progress, job status, and activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">Coming soon</CardContent>
        </Card>
      </div>
    </div>
  )
}
