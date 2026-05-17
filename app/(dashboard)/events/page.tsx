import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { EventsMonitor } from "@/components/events/events-monitor"
import { getSocketUrlSsrDefault } from "@/lib/realtime/client-socket-url"
import { socketEventTypes } from "@/lib/types/events"

const socketUrl = getSocketUrlSsrDefault()

export default function EventsPage() {
  const shortUrl = socketUrl.length > 28 ? `${socketUrl.slice(0, 26)}…` : socketUrl

  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Events"
        subtitle="Live Socket.IO event monitor"
        description="Watch every realtime event this instance emits — uploads, asset changes, job progress, and more. The dashboard connects through this site’s origin (session cookie). External scripts use port 4000 with an API key. Click any event to expand its payload."
        stats={[
          { label: "Transport",    value: "Socket.IO" },
          { label: "Event types",  value: socketEventTypes.length.toString() },
          { label: "Default URL",  value: shortUrl },
          { label: "Auth",         value: "Session cookie" },
        ]}
      />
      <EventsMonitor />
    </div>
  )
}
