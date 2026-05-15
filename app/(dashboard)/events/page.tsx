import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { EventsMonitor } from "@/components/events/events-monitor"
import { socketEventTypes } from "@/lib/types/events"

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"

export default function EventsPage() {
  const shortUrl = socketUrl.length > 28 ? `${socketUrl.slice(0, 26)}…` : socketUrl

  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Events"
        subtitle="Live Socket.IO event monitor"
        description="Watch every realtime event this instance emits — uploads, asset changes, job progress, and more. Events stream directly from the Socket.IO server using your active session. Click any event to expand its payload."
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
