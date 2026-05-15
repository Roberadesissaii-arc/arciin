import Link from "next/link"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { RemoteAccessPanel } from "@/components/settings/remote-access-panel"
import { WebSocketsOverview } from "@/components/settings/web-sockets-overview"
import { Button } from "@/components/ui/button"

export default function DeveloperWebSocketsPage() {
  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <DashboardPageIntro
        title="WebSockets"
        subtitle="Ingress & upgrades"
        description="Configure tunnel and reverse-proxy flags so browsers can open WebSocket connections to this instance. Set the public HTTPS origin under Settings → Domain. Install snippets and proxy samples live in Documentation."
        stats={[
          { label: "This page", value: "Configure" },
          { label: "Toggles", value: "Here" },
          { label: "Commands", value: "Docs" },
          { label: "Public URL", value: "Settings" },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild className="border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50">
              <Link href="/settings?tab=domain">Domain (public URL)</Link>
            </Button>
            <Button size="sm" asChild className="bg-primary text-white hover:bg-primary/90">
              <Link href="/developer">Developer hub</Link>
            </Button>
          </>
        }
      />
      <RemoteAccessPanel />
      <WebSocketsOverview />
    </div>
  )
}
