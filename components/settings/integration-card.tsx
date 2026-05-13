import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { IntegrationSummary } from "@/lib/types/models"

export function IntegrationCard({
  integration,
  cta,
}: {
  integration: IntegrationSummary
  cta?: React.ReactNode
}) {
  return (
    <Card className="border-white/8 bg-white/[0.02]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-white">{integration.name}</CardTitle>
            <CardDescription className="text-zinc-400">
              {integration.type === "PLEX"
                ? "Organize compatible folders first, then wire in the full server connection later."
                : "Future integration slot for the Arciin instance."}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={integration.enabled ? "border-emerald-500/20 text-emerald-300" : "border-white/8 text-zinc-400"}
          >
            {integration.enabled ? "Connected" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">
          {integration.type === "PLEX"
            ? "Start with a Videos/Plex folder structure and enable server credentials later."
            : "This integration slot is reserved for future self-hosted services."}
        </div>
        {cta || (
          <Button variant="outline" className="border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]">
            Coming soon
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
