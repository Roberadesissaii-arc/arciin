import { EventsMonitor } from "@/components/events/events-monitor"
import { EventsPageIntro } from "@/components/events/events-page-intro"

export default function EventsPage() {
  return (
    <div className="space-y-5 pb-6">
      <EventsPageIntro />
      <EventsMonitor />
    </div>
  )
}
