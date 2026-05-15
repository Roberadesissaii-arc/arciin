import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function LogsPage() {
  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Logs"
        subtitle="API · workers · filesystem output"
        description="Arciin writes structured logs to disk today; the UI here explains where to look and what will ship next. Live tailing from the browser is planned once log shipping is wired."
        stats={[
          { label: "API transport", value: "Pino → disk" },
          { label: "Worker logs", value: "Separate process" },
          { label: "Default path", value: "data/arciin/logs" },
          { label: "Live stream", value: "Planned" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">API logs</CardTitle>
            <CardDescription className="text-zinc-600">
              Fastify request and response logs from the local API server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-600">
            <p>Logs are written to disk by Pino at the configured level.</p>
            <p>
              Check <span className="font-mono text-zinc-800">./data/arciin/logs/</span> for the current log
              files.
            </p>
            <p>Live log streaming will be available in a later release.</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Worker logs</CardTitle>
            <CardDescription className="text-zinc-600">
              BullMQ job processor output for uploads, thumbnails, and classification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-600">
            <p>Worker processes run separately from the API server.</p>
            <p>Job results and errors are stored in the Jobs table and visible on the Jobs page.</p>
            <p>Failed jobs are retried automatically with exponential backoff.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
